"use client";

import React, { useEffect, useState } from "react";
import { Settings, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState({ name: "", time_zone: "", slug: "" });
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.company) {
          setCompany({
            name: data.company.name || "",
            time_zone: data.company.time_zone || "UTC",
            slug: data.company.slug || "",
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Manage company and scoring configuration</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="scoring">Scoring Policy</TabsTrigger>
          <TabsTrigger value="imports">Import Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Details</CardTitle>
              <CardDescription>Manage your company workspace settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Company Name</label>
                <Input
                  value={company.name}
                  onChange={(e) => setCompany({ ...company, name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Workspace Slug</label>
                <Input value={company.slug} disabled className="mt-1 bg-[var(--muted)]" />
                <p className="text-xs text-[var(--muted-foreground)] mt-1">Cannot be changed after creation</p>
              </div>
              <div>
                <label className="text-sm font-medium">Time Zone</label>
                <select
                  value={company.time_zone}
                  onChange={(e) => setCompany({ ...company, time_zone: e.target.value })}
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-[var(--background)] border-[var(--border)]"
                >
                  {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"].map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <Button disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scoring" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Scoring Policy</CardTitle>
              <CardDescription>Current scoring configuration (read-only)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold mb-3">Factor Ratings</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[var(--muted)]/50">
                          <th className="text-left px-4 py-2 font-medium">Factor</th>
                          <th className="text-center px-4 py-2 font-medium">1</th>
                          <th className="text-center px-4 py-2 font-medium">3</th>
                          <th className="text-center px-4 py-2 font-medium">6</th>
                          <th className="text-center px-4 py-2 font-medium">9</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs">
                        <tr className="border-b">
                          <td className="px-4 py-2 font-medium">Market Access (A)</td>
                          <td className="px-4 py-2 text-center">&lt; $100K</td>
                          <td className="px-4 py-2 text-center">$100K–$1M</td>
                          <td className="px-4 py-2 text-center">$1M–$5M</td>
                          <td className="px-4 py-2 text-center">&gt; $5M</td>
                        </tr>
                        <tr className="border-b">
                          <td className="px-4 py-2 font-medium">Cost to Implement (B)</td>
                          <td className="px-4 py-2 text-center">&lt; $25K</td>
                          <td className="px-4 py-2 text-center">$25K–$250K</td>
                          <td className="px-4 py-2 text-center">$250K–$1M</td>
                          <td className="px-4 py-2 text-center">&gt; $1M</td>
                        </tr>
                        <tr className="border-b">
                          <td className="px-4 py-2 font-medium">People (C)</td>
                          <td className="px-4 py-2 text-center">0 FTE</td>
                          <td className="px-4 py-2 text-center">0–5 FTE</td>
                          <td className="px-4 py-2 text-center">5–10 FTE</td>
                          <td className="px-4 py-2 text-center">&gt; 10 FTE</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 font-medium">Urgency (D)</td>
                          <td className="px-4 py-2 text-center">&gt; 36 mo</td>
                          <td className="px-4 py-2 text-center">18–36 mo</td>
                          <td className="px-4 py-2 text-center">6–18 mo</td>
                          <td className="px-4 py-2 text-center">≤ 6 mo</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Risk Bands</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Low", range: "1–80", color: "var(--priority-low)" },
                      { label: "Moderate", range: "81–500", color: "var(--priority-moderate)" },
                      { label: "High", range: "501–2,000", color: "var(--priority-high)" },
                      { label: "Critical", range: "2,001–6,561", color: "var(--priority-critical)" },
                    ].map((band) => (
                      <div key={band.label} className="border rounded-lg p-3 text-center">
                        <div className="w-3 h-3 rounded-full mx-auto mb-2" style={{ backgroundColor: band.color }} />
                        <div className="text-sm font-medium">{band.label}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{band.range}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Escalation Rules</h3>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--priority-high)] mt-1.5 shrink-0" />
                      Market access = 9 gives minimum priority of <strong>High</strong>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--priority-critical)] mt-1.5 shrink-0" />
                      Urgency = 9 gives <strong>Critical</strong>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--priority-critical)] mt-1.5 shrink-0" />
                      Market access = 9 and Urgency ≥ 6 gives <strong>Critical</strong>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--priority-critical)] mt-1.5 shrink-0" />
                      Forecast missed compliance deadline gives <strong>Critical</strong>
                    </li>
                  </ul>
                </div>

                <p className="text-xs text-[var(--muted-foreground)]">
                  Formula: Raw Score = A × B × C × D (min 1, max 6,561)
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imports" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Import Configuration</CardTitle>
              <CardDescription>Default settings for data imports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Default Dataset</label>
                <Input value="Daptic Alert Feed" disabled className="mt-1 bg-[var(--muted)]" />
              </div>
              <div>
                <label className="text-sm font-medium">Update Mode</label>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  <strong>Preserve</strong> (default): Blank cells in an update retain previous values. Local edits are always preserved.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Supported Formats</label>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  Excel (.xlsx) and CSV (.csv) with 27-column Daptic mapping
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
