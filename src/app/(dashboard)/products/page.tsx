"use client";

import { useEffect, useState, useCallback } from "react";

interface Product {
  id: string;
  model_code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface Family {
  id: string;
  name: string;
  description: string | null;
  state: string;
  products: Product[] | null;
}

export default function ProductsPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreateFamily, setShowCreateFamily] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState<string | null>(null);
  const [familyForm, setFamilyForm] = useState({ name: "", description: "" });
  const [productForm, setProductForm] = useState({ name: "", model_code: "", description: "" });
  const [saving, setSaving] = useState(false);

  const loadFamilies = useCallback(async () => {
    const res = await fetch("/api/products");
    const data = await res.json();
    setFamilies(data.families || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadFamilies(); }, [loadFamilies]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleCreateFamily(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(familyForm) });
    setShowCreateFamily(false);
    setFamilyForm({ name: "", description: "" });
    setSaving(false);
    loadFamilies();
  }

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/products/${showAddProduct}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_product", ...productForm }),
    });
    setShowAddProduct(null);
    setProductForm({ name: "", model_code: "", description: "" });
    setSaving(false);
    loadFamilies();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Product Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage product families and models</p>
        </div>
        <button onClick={() => setShowCreateFamily(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          Add family
        </button>
      </div>

      {/* Create family dialog */}
      {showCreateFamily && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">New product family</h2>
            <form onSubmit={handleCreateFamily} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input type="text" required value={familyForm.name} onChange={(e) => setFamilyForm({ ...familyForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea value={familyForm.description} onChange={(e) => setFamilyForm({ ...familyForm, description: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowCreateFamily(false)} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg">{saving ? "Saving..." : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add product dialog */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Add product</h2>
            <form onSubmit={handleAddProduct} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input type="text" required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Model code</label>
                <input type="text" value={productForm.model_code} onChange={(e) => setProductForm({ ...productForm, model_code: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowAddProduct(null)} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg">{saving ? "Saving..." : "Add"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}</div>
      ) : families.length === 0 ? (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400">
          <p className="text-lg font-medium">No product families yet</p>
          <p className="text-sm mt-1">Add a product family to start linking alerts to products</p>
        </div>
      ) : (
        <div className="space-y-3">
          {families.map((f) => (
            <div key={f.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50" onClick={() => toggle(f.id)}>
                <div className="flex items-center gap-3">
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${expanded.has(f.id) ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{f.name}</p>
                    {f.description && <p className="text-xs text-slate-500 dark:text-slate-400">{f.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{f.products?.length || 0} models</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${f.state === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-slate-100 text-slate-500"}`}>
                    {f.state}
                  </span>
                </div>
              </div>
              {expanded.has(f.id) && (
                <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
                  {f.products && f.products.length > 0 ? (
                    <div className="space-y-2">
                      {f.products.map((p) => (
                        <div key={p.id} className="flex items-center justify-between py-1.5 px-3 rounded bg-white dark:bg-slate-700/50 text-sm">
                          <div>
                            <span className="font-medium text-slate-900 dark:text-white">{p.name}</span>
                            {p.model_code && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">({p.model_code})</span>}
                          </div>
                          <span className={`text-xs ${p.is_active ? "text-green-600 dark:text-green-400" : "text-slate-400"}`}>
                            {p.is_active ? "Active" : "Archived"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No products in this family</p>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); setShowAddProduct(f.id); }}
                    className="mt-3 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">
                    + Add product
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
