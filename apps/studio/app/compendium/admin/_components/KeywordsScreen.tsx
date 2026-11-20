"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthoringApiError, getAuthoring, postAuthoring } from "../_lib/authoring-client";

/**
 * RULES-WO1 — the Keywords screen. Keywords are discovery and matching vocabulary (Affinity Strengths / Weaknesses match
 * them); they carry no mechanics of their own. Lists every Keyword by category and creates Keywords and categories
 * through the existing M1 services (POST /api/keywords, POST /api/keyword-categories). The machine key is derived from
 * the name; nobody types it. M1 has no edit or rename service for Keywords, so this screen does not offer one.
 */
interface Keyword {
  id: string;
  canonicalKey: string;
  name: string;
  categoryId: string | null;
  description: string | null;
  deprecated: boolean;
}
interface Category {
  id: string;
  canonicalKey: string;
  name: string;
  description: string | null;
}
const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const messageOf = (e: unknown) => (e instanceof AuthoringApiError ? e.message : "The request failed.");

export function KeywordsScreen() {
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [kw, setKw] = useState({ name: "", categoryId: "", description: "" });
  const [cat, setCat] = useState({ name: "", description: "" });
  const [filter, setFilter] = useState("");

  const fetchAll = useCallback(() => Promise.all([getAuthoring<Keyword[]>("/api/keywords"), getAuthoring<Category[]>("/api/keyword-categories")]), []);
  const load = useCallback(async () => {
    try {
      const [k, c] = await fetchAll();
      setKeywords(k);
      setCategories(c);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [fetchAll]);
  useEffect(() => {
    let live = true;
    fetchAll().then(
      ([k, c]) => {
        if (!live) return;
        setKeywords(k);
        setCategories(c);
      },
      (e: unknown) => live && setError(messageOf(e)),
    );
    return () => {
      live = false;
    };
  }, [fetchAll]);

  async function createKeyword() {
    setError("");
    setNotice("");
    try {
      await postAuthoring("/api/keywords", { canonicalKey: keywordKey, name: kw.name.trim(), categoryId: kw.categoryId || null, description: kw.description.trim() || null });
      setNotice(`Keyword "${kw.name.trim()}" created.`);
      setKw({ name: "", categoryId: kw.categoryId, description: "" });
      await load();
    } catch (e) {
      setError(messageOf(e));
    }
  }
  async function createCategory() {
    setError("");
    setNotice("");
    try {
      await postAuthoring("/api/keyword-categories", { canonicalKey: categoryKey, name: cat.name.trim(), description: cat.description.trim() || null });
      setNotice(`Category "${cat.name.trim()}" created.`);
      setCat({ name: "", description: "" });
      await load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  // The permanent key is made from the name and SHOWN before creation (never set silently); nothing is typed.
  const keywordKey = `${categories.find((c) => c.id === kw.categoryId)?.canonicalKey ?? "keyword"}.${slug(kw.name)}`;
  const categoryKey = `keyword_category.${slug(cat.name)}`;
  const shown = (keywords ?? []).filter((k) => filter.trim() === "" || k.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const groups = [...categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: "No category" }];
  return (
    <section className="prowess-reference" data-testid="keywords-screen">
      <nav className="gov-crumbs" aria-label="Breadcrumb">
        <Link href="/compendium/admin">Compendium Admin</Link> / <span aria-current="page">Keywords</span>
      </nav>
      <h1>Keywords</h1>
      <p>Keywords describe content so it can be found and matched (for example by an Affinity&apos;s Strengths and Weaknesses). A Keyword has no mechanics of its own.</p>
      {error ? (
        <p className="gov-bad" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="gov-ok" role="status">
          {notice}
        </p>
      ) : null}

      <section className="gov-panel" aria-labelledby="kw-new-h">
        <h2 id="kw-new-h">New Keyword</h2>
        <label className="gov-field">
          <span>Name (required)</span>
          <input value={kw.name} onChange={(e) => setKw({ ...kw, name: e.target.value })} />
        </label>
        <label className="gov-field">
          <span>Category</span>
          <select value={kw.categoryId} onChange={(e) => setKw({ ...kw, categoryId: e.target.value })}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>Description</span>
          <input value={kw.description} onChange={(e) => setKw({ ...kw, description: e.target.value })} />
        </label>
        {slug(kw.name) !== "" ? (
          <p className="gov-muted" data-testid="keyword-key-preview">
            Its permanent key will be <code>{keywordKey}</code> (made from the name; renaming it later does not change the key).
          </p>
        ) : null}
        <button type="button" className="gov-button gov-button--primary" disabled={slug(kw.name) === ""} onClick={() => void createKeyword()}>
          Create Keyword
        </button>
      </section>

      <section className="gov-panel" aria-labelledby="kw-cat-h">
        <h2 id="kw-cat-h">New category</h2>
        <label className="gov-field">
          <span>Category name (required)</span>
          <input value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
        </label>
        <label className="gov-field">
          <span>Category description</span>
          <input value={cat.description} onChange={(e) => setCat({ ...cat, description: e.target.value })} />
        </label>
        {slug(cat.name) !== "" ? (
          <p className="gov-muted" data-testid="category-key-preview">
            Its permanent key will be <code>{categoryKey}</code>.
          </p>
        ) : null}
        <button type="button" className="gov-button" disabled={slug(cat.name) === ""} onClick={() => void createCategory()}>
          Create category
        </button>
      </section>

      <section className="gov-panel" aria-labelledby="kw-list-h">
        <h2 id="kw-list-h">All Keywords</h2>
        <label className="gov-field">
          <span>Find a Keyword</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {keywords === null ? <p role="status">Loading…</p> : null}
        {groups.map((g) => {
          const items = shown.filter((k) => k.categoryId === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id ?? "none"}>
              <h3>{g.name}</h3>
              <ul data-testid="keyword-list">
                {items.map((k) => (
                  <li key={k.id}>
                    <strong>{k.name}</strong>
                    {k.deprecated ? <span className="gov-tag"> deprecated</span> : null}
                    {k.description ? <span className="gov-muted"> — {k.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </section>
  );
}
