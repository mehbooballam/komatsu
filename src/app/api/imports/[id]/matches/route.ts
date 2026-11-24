import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { canImport, forbidden, getAuth, unauthorized } from "@/lib/auth-helpers";
import { compareRowWith, loadImportMatches, type Decision, type ImportMatches } from "@/lib/import/match-plan";

export const maxDuration = 120;

const UUID = /^[0-9a-f-]{36}$/i;

async function loadBatch(id: string, companyId: string) {
  if (!UUID.test(id)) return null;
  const res = await query(
    `SELECT id, feed_id, status, column_mapping, match_threshold FROM import_batches WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  return res.rows[0] ?? null;
}

const summary = (m: ImportMatches) => ({ threshold: m.threshold, rows: m.rows, undecided: m.undecided, conflicts: m.conflicts, totals: m.totals });

/**
 * GET — rows of an import in preview that match an existing alert (or another row) by content, with the
 * match percentage and the decision so far. With ?row=&target= : the column-by-column comparison.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const batch = await loadBatch((await params).id, auth.company_id);
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const row = Number(request.nextUrl.searchParams.get("row"));
  const target = request.nextUrl.searchParams.get("target");
  if (target) {
    const match = Number.isInteger(row) ? await compareRowWith(auth.company_id, batch, row, target) : null;
    if (!match) return NextResponse.json({ error: "Nothing to compare" }, { status: 404 });
    return NextResponse.json(match);
  }
  return NextResponse.json(summary(await loadImportMatches(auth.company_id, batch)));
}

/**
 * PUT { threshold?: number, decisions?: [{ row, action: "replace" | "ignore" | "add" | null, target }] }
 * Saves the threshold and what to do with matching rows; returns the updated matches.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return unauthorized();
  if (!canImport(auth.role)) return forbidden();
  const batch = await loadBatch((await params).id, auth.company_id);
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  if (batch.status !== "previewing") {
    return NextResponse.json({ error: "Decisions can only be changed before the import runs" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.threshold !== undefined) {
    const t = Number(body.threshold);
    if (!Number.isInteger(t) || t < 40 || t > 100) return NextResponse.json({ error: "The match percentage must be between 40 and 100" }, { status: 400 });
    await query(`UPDATE import_batches SET match_threshold = $2 WHERE id = $1`, [batch.id, t]);
    batch.match_threshold = t;
  }

  if (body.decisions !== undefined) {
    if (!Array.isArray(body.decisions)) return NextResponse.json({ error: "decisions must be a list" }, { status: 400 });
    const current = await loadImportMatches(auth.company_id, batch);
    const byRow = new Map(current.rows.map((m) => [m.row, m]));
    const clean: Array<{ row_number: number; decision: Decision | null; decision_target: string | null; decision_score: number | null }> = [];
    for (const d of body.decisions as Array<{ row?: unknown; action?: unknown; target?: unknown } | null>) {
      const m = byRow.get(Number(d?.row));
      const opt = m?.matches.find((x) => x.target === d?.target);
      const action = d?.action ?? null;
      if (!m || !opt || !(action === null || action === "replace" || action === "ignore" || action === "add")) {
        return NextResponse.json({ error: "A decision is for a row that no longer matches. Reload the matches." }, { status: 400 });
      }
      clean.push({ row_number: m.row, decision: action, decision_target: action ? opt.target : null, decision_score: action ? opt.score : null });
    }
    if (clean.length) {
      await query(
        `UPDATE import_rows ir SET decision = v.decision, decision_target = v.decision_target, decision_score = v.decision_score
         FROM jsonb_to_recordset($2::jsonb) AS v(row_number int, decision text, decision_target text, decision_score smallint)
         WHERE ir.batch_id = $1 AND ir.row_number = v.row_number`,
        [batch.id, JSON.stringify(clean)]
      );
    }
  }
  return NextResponse.json(summary(await loadImportMatches(auth.company_id, batch)));
}
