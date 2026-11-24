import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { processImportBatch } from "@/lib/import/processor";
import { mappingProblems, type ColumnMapping } from "@/lib/import/mapping";
import { loadImportMatches } from "@/lib/import/match-plan";

// Imports and AI grouping runs (which continue after the response) can take minutes
export const maxDuration = 300;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();

  const { id } = await params;

  // Claim the batch and check its state in one statement so concurrent confirmations
  // cannot both start processing it.
  const claimed = await query(
    `UPDATE import_batches SET status = 'processing', started_at = now()
     WHERE id = $1 AND company_id = $2 AND status = 'previewing'
     RETURNING id, feed_id, update_mode, column_mapping, mapping_profile_id, match_threshold`,
    [id, auth.company_id]
  );
  const batch = claimed.rows[0];
  if (!batch) {
    const current = await query(
      `SELECT status FROM import_batches WHERE id = $1 AND company_id = $2`,
      [id, auth.company_id]
    );
    if (!current.rows[0]) {
      return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Cannot confirm batch in status: ${current.rows[0].status}` },
      { status: 409 }
    );
  }

  try {
    // Restore the batch's column mapping (as reviewed in the preview) and use the same validation.
    const columnMapping: ColumnMapping = batch.column_mapping || {};
    const problems = mappingProblems(columnMapping);
    if (problems.length) {
      await query(`UPDATE import_batches SET status = 'previewing', started_at = NULL WHERE id = $1`, [id]);
      return NextResponse.json({ error: "Fix the column mapping first", problems }, { status: 400 });
    }
    // Rows that match another alert by content are imported only after a person decided what to do with them
    const matches = await loadImportMatches(auth.company_id, batch);
    if (matches.undecided || matches.conflicts) {
      await query(`UPDATE import_batches SET status = 'previewing', started_at = NULL WHERE id = $1`, [id]);
      const n = matches.undecided || matches.conflicts;
      return NextResponse.json(
        {
          error: matches.undecided
            ? `${n} row${n === 1 ? " matches" : "s match"} other alerts. Choose Replace, Ignore or Add as new first.`
            : `${n} decision${n === 1 ? "" : "s"} can't be carried out. Check the matches.`,
          undecided: matches.undecided,
          conflicts: matches.conflicts,
        },
        { status: 409 }
      );
    }
    // Keep decisions carried over from an earlier import with this one too
    const carried = matches.rows.filter((m) => m.source === "earlier" && m.decision);
    if (carried.length) {
      await query(
        `UPDATE import_rows ir SET decision = v.decision, decision_target = v.decision_target, decision_score = v.decision_score
         FROM jsonb_to_recordset($2::jsonb) AS v(row_number int, decision text, decision_target text, decision_score smallint)
         WHERE ir.batch_id = $1 AND ir.row_number = v.row_number`,
        [
          id,
          JSON.stringify(
            carried.map((m) => ({
              row_number: m.row,
              decision: m.decision,
              decision_target: m.target,
              decision_score: m.matches.find((x) => x.target === m.target)?.score ?? null,
            }))
          ),
        ]
      );
    }
    if (batch.mapping_profile_id) {
      await query(`UPDATE import_mapping_profiles SET last_used_at = now() WHERE id = $1`, [batch.mapping_profile_id]);
    }
    const result = await processImportBatch(
      id,
      auth.company_id,
      batch.feed_id,
      matches.validated,
      batch.update_mode || "preserve",
      matches.plan,
      auth.membership_id
    );

    return NextResponse.json({
      batchId: id,
      status: "completed",
      counts: result,
    });
  } catch (error) {
    console.error("Import processing failed:", error);
    // Processing can fail before the processor starts its transaction.
    await query(
      `UPDATE import_batches SET status = 'failed', completed_at = now(), error_summary = $3
       WHERE id = $1 AND company_id = $2 AND status = 'processing'`,
      [id, auth.company_id, JSON.stringify({ message: "Import processing failed" })]
    ).catch((statusError: unknown) => console.error("Could not update import status:", statusError));
    return NextResponse.json({ error: "Import processing failed" }, { status: 500 });
  }
}
