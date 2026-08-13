import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
} from "recharts";
import {
  Home, List, PieChart as PieIcon, Wallet, Plus, X,
  AlertTriangle, ChevronLeft, ChevronRight, Trash2, Landmark, Banknote, CreditCard,
  Cloud, CloudUpload, CloudDownload, Tags, FileSpreadsheet, FileDown, Layers, Check, Pencil,
  Sun, Moon, ArrowLeftRight, History,
} from "lucide-react";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

// ---------- Design tokens ----------
const DARK_COLORS = {
  bg: "#12202B",
  surface: "#1B2C39",
  surface2: "#233A49",
  border: "#2E4757",
  text: "#EDEAE2",
  textDim: "#93A6B3",
  gold: "#C9974C",
  mint: "#4FD8A0",
  coral: "#E8674B",
  sky: "#5FA8D3",
  purple: "#B589D6",
};
const LIGHT_COLORS = {
  bg: "#F5F1E9",
  surface: "#FFFFFF",
  surface2: "#EDE6D8",
  border: "#DDD3C0",
  text: "#20303A",
  textDim: "#6C7A82",
  gold: "#AD7A34",
  mint: "#2FA574",
  coral: "#D14E30",
  sky: "#2F7FB0",
  purple: "#8E5CB8",
};
// COLORS is a mutable singleton so every component (which reads COLORS.xxx
// directly at render time, not via props/context) picks up the active theme
// as soon as applyTheme() mutates it and a re-render happens.
const COLORS = { ...DARK_COLORS };
function applyTheme(theme) {
  Object.assign(COLORS, theme === "light" ? LIGHT_COLORS : DARK_COLORS);
}

const PALETTE = ["#4FD8A0", "#5FA8D3", "#C9974C", "#B589D6", "#E8674B", "#E0B84B", "#7C93A3", "#93A6B3"];
function shadeColor(hex, percent) {
  const c = (hex || "#93A6B3").replace("#", "");
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const num = parseInt(full, 16) || 0x93A6B3;
  let r = (num >> 16) + Math.round(2.55 * percent);
  let g = ((num >> 8) & 0x00ff) + Math.round(2.55 * percent);
  let b = (num & 0x0000ff) + Math.round(2.55 * percent);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const ACCOUNT_ICONS = { "Banque": Landmark, "Espèces": Banknote, "Carte": CreditCard };
const getAccountColor = (type) => ({ "Banque": COLORS.sky, "Espèces": COLORS.mint, "Carte": COLORS.purple }[type] || COLORS.gold);

const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};

function buildDefaultCategories() {
  const mk = (name, icon, color, parentId = null, nature = "expense") => ({ id: uid(), name, icon, color, parentId, nature });
  const alim = mk("Alimentation", "🍽️", "#4FD8A0");
  const transport = mk("Transport", "🚗", "#5FA8D3");
  const logement = mk("Logement", "🏠", "#C9974C");
  const loisirs = mk("Loisirs", "🎬", "#B589D6");
  const sante = mk("Santé", "🩺", "#E8674B");
  const shopping = mk("Shopping", "🛍️", "#E0B84B");
  const factures = mk("Factures", "📄", "#7C93A3");
  const revenu = mk("Revenu", "💰", "#4FD8A0", null, "income");
  const virement = { ...mk("Virement", "🔄", "#5FA8D3"), isTransferCategory: true };
  const autre = mk("Autre", "✨", "#93A6B3");
  return [
    alim, mk("Courses", "🛒", "#4FD8A0", alim.id), mk("Restaurants", "🍔", "#4FD8A0", alim.id),
    transport, mk("Carburant", "⛽", "#5FA8D3", transport.id), mk("Transport public", "🚌", "#5FA8D3", transport.id),
    logement, mk("Loyer", "🔑", "#C9974C", logement.id), mk("Charges", "💡", "#C9974C", logement.id),
    loisirs, mk("Sorties", "🎉", "#B589D6", loisirs.id), mk("Abonnements", "📺", "#B589D6", loisirs.id),
    sante, shopping, factures, revenu, virement, autre,
  ];
}

const DEFAULT_ACCOUNTS = [
  { id: uid(), name: "Compte courant", type: "Banque", initialBalance: 1200 },
  { id: uid(), name: "Espèces", type: "Espèces", initialBalance: 80 },
];

// ---------- Category helpers ----------
const catById = (categories, id) => categories.find((c) => c.id === id);
const catMeta = (categories, id) => catById(categories, id) || { name: "Autre", icon: "✨", color: COLORS.textDim, parentId: null };
const topIdOf = (categories, id) => {
  const c = catById(categories, id);
  if (!c) return id;
  return c.parentId || c.id;
};
const catLabel = (categories, id) => {
  const c = catById(categories, id);
  if (!c) return "Autre";
  if (c.parentId) {
    const parent = catById(categories, c.parentId);
    return parent ? `${parent.name} · ${c.name}` : c.name;
  }
  return c.name;
};

export default function BudgetTracker() {
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState("dark");
  applyTheme(theme); // mutate the shared COLORS object before this render reads it
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState(() => buildDefaultCategories());
  const [categoryTransfers, setCategoryTransfers] = useState([]);
  const [tab, setTab] = useState("home");
  const [showAdd, setShowAdd] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountDetailId, setAccountDetailId] = useState(null);
  const [showCategoryTransfer, setShowCategoryTransfer] = useState(false);
  const [showTransfersHistory, setShowTransfersHistory] = useState(false);
  const [periodMode, setPeriodMode] = useState("month"); // "month" | "year"
  const [monthCursor, setMonthCursor] = useState(monthKey(new Date()));
  const [yearCursor, setYearCursor] = useState(new Date().getFullYear());

  const shiftMonth = useCallback((delta) => {
    setMonthCursor((prev) => {
      const [y, m] = prev.split("-").map(Number);
      return monthKey(new Date(y, m - 1 + delta, 1));
    });
  }, []);
  const shiftYear = useCallback((delta) => setYearCursor((y) => y + delta), []);
  const periodLabel = periodMode === "year" ? String(yearCursor) : monthLabel(monthCursor);
  const [toast, setToast] = useState(null);
  const [cloudStatus, setCloudStatus] = useState("idle");
  const [lastSynced, setLastSynced] = useState(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);

  const pressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);

  const handleAccountPressStart = useCallback((id) => {
    longPressFiredRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setSelectedAccountIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }, 450);
  }, []);
  const handleAccountPressEnd = useCallback((id) => {
    clearTimeout(pressTimerRef.current);
    if (!longPressFiredRef.current) {
      setSelectedAccountIds((prev) => (prev.length === 1 && prev[0] === id) ? [] : [id]);
    }
  }, []);
  const handleAccountPressCancel = useCallback(() => {
    clearTimeout(pressTimerRef.current);
  }, []);

  // ---------- Load ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("budgetbacker:data");
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed.accounts?.length) {
            setAccounts(parsed.accounts.map((a) => (
              a.initialBalance !== undefined ? a : { ...a, initialBalance: a.balance || 0 }
            )));
          }
          if (parsed.transactions) setTransactions(parsed.transactions);
          if (parsed.budgets) setBudgets(parsed.budgets);
          if (parsed.categories?.length) setCategories(parsed.categories);
          if (parsed.categoryTransfers) setCategoryTransfers(parsed.categoryTransfers);
          if (parsed.theme === "light" || parsed.theme === "dark") setTheme(parsed.theme);
        }
      } catch (e) {
        // no saved data yet, keep defaults
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---------- Save ----------
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      try {
        await storage.set(
          "budgetbacker:data",
          JSON.stringify({ accounts, transactions, budgets, categories, categoryTransfers, theme })
        );
      } catch (e) {
        console.error("Erreur de sauvegarde", e);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [accounts, transactions, budgets, categories, categoryTransfers, theme, ready]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // ---------- Barre de statut Android : couleur/style assortis au thème actif ----------
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setBackgroundColor({ color: COLORS.bg });
        await StatusBar.setStyle({ style: theme === "light" ? Style.Light : Style.Dark });
      } catch (e) {
        // plateforme sans barre de statut native (aperçu navigateur) : on ignore
      }
    })();
  }, [theme]);

  // ---------- Bouton retour Android : 1er retour -> accueil, 2e retour rapproché -> quitte l'app ----------
  const lastBackPressRef = useRef(0);
  useEffect(() => {
    window.history.pushState({ bb: true }, "");
    const onPopState = () => {
      if (showAdd) { setShowAdd(false); window.history.pushState({ bb: true }, ""); return; }
      if (showAddAccount) { setShowAddAccount(false); window.history.pushState({ bb: true }, ""); return; }
      if (showCategoryTransfer) { setShowCategoryTransfer(false); window.history.pushState({ bb: true }, ""); return; }
      if (showTransfersHistory) { setShowTransfersHistory(false); window.history.pushState({ bb: true }, ""); return; }
      if (accountDetailId) { setAccountDetailId(null); window.history.pushState({ bb: true }, ""); return; }
      if (tab !== "home") { setTab("home"); window.history.pushState({ bb: true }, ""); return; }
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        // 2e appui rapproché : on laisse l'app se fermer (pas de nouveau pushState)
        return;
      }
      lastBackPressRef.current = now;
      showToast("Réappuyez sur retour pour quitter");
      window.history.pushState({ bb: true }, "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [tab, showAdd, showAddAccount, showCategoryTransfer, showTransfersHistory, accountDetailId, showToast]);

  // ---------- Derived ----------
  const accountsWithBalance = useMemo(() => accounts.map((a) => ({
    ...a,
    balance: (a.initialBalance || 0) + transactions.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amount, 0),
  })), [accounts, transactions]);

  const visibleTx = useMemo(
    () => selectedAccountIds.length === 0 ? transactions : transactions.filter((t) => selectedAccountIds.includes(t.accountId)),
    [transactions, selectedAccountIds]
  );
  const periodTx = useMemo(
    () => periodMode === "year"
      ? visibleTx.filter((t) => new Date(t.date).getFullYear() === yearCursor)
      : visibleTx.filter((t) => monthKey(new Date(t.date)) === monthCursor),
    [visibleTx, periodMode, monthCursor, yearCursor]
  );
  const totalBalance = useMemo(() => {
    const list = selectedAccountIds.length === 0 ? accountsWithBalance : accountsWithBalance.filter((a) => selectedAccountIds.includes(a.id));
    return list.reduce((s, a) => s + a.balance, 0);
  }, [accountsWithBalance, selectedAccountIds]);

  // One row per transfer (merging the two legs created by addTransfer) for the transfers-history view.
  const accountTransferGroups = useMemo(() => {
    const byGroup = new Map();
    transactions.forEach((t) => {
      if (!t.isTransfer || !t.transferGroup) return;
      if (!byGroup.has(t.transferGroup)) byGroup.set(t.transferGroup, []);
      byGroup.get(t.transferGroup).push(t);
    });
    const groups = [];
    byGroup.forEach((legs, groupId) => {
      const out = legs.find((l) => l.amount < 0);
      const inn = legs.find((l) => l.amount > 0);
      if (!out || !inn) return;
      const fromAcc = accounts.find((a) => a.id === out.accountId);
      const toAcc = accounts.find((a) => a.id === inn.accountId);
      groups.push({
        id: groupId, date: out.date, amount: Math.abs(out.amount),
        fromAccountName: fromAcc?.name || "?", toAccountName: toAcc?.name || "?",
        label: out.label, txId: out.id,
      });
    });
    return groups.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [transactions, accounts]);

  // Roll up spending by TOP-level category (subcategory amounts included in parent)
  const byCategory = useMemo(() => {
    const map = {};
    periodTx.filter((t) => t.amount < 0 && !t.isTransfer).forEach((t) => {
      const topId = topIdOf(categories, t.categoryId);
      map[topId] = (map[topId] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map).map(([id, value]) => {
      const meta = catMeta(categories, id);
      return { id, name: meta.name, icon: meta.icon, value, color: meta.color };
    }).sort((a, b) => b.value - a.value);
  }, [periodTx, categories]);

  // Category transfers reallocate BUDGET CAPACITY between categories for the
  // period shown (month or year, matching periodTx) - they never touch real
  // transactions, account balances, or income/expense totals.
  const periodCategoryTransfers = useMemo(() => (
    periodMode === "year"
      ? categoryTransfers.filter((t) => new Date(t.date).getFullYear() === yearCursor)
      : categoryTransfers.filter((t) => monthKey(new Date(t.date)) === monthCursor)
  ), [categoryTransfers, periodMode, monthCursor, yearCursor]);

  const categoryTransferNet = useMemo(() => {
    const map = {};
    periodCategoryTransfers.forEach((t) => {
      map[t.fromCategoryId] = (map[t.fromCategoryId] || 0) - t.amount;
      map[t.toCategoryId] = (map[t.toCategoryId] || 0) + t.amount;
    });
    return map;
  }, [periodCategoryTransfers]);

  const budgetStatus = useMemo(() => {
    return budgets.map((b) => {
      const spent = periodTx
        .filter((t) => topIdOf(categories, t.categoryId) === b.categoryId && t.amount < 0 && !t.isTransfer)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const transferDelta = categoryTransferNet[b.categoryId] || 0;
      const effectiveLimit = b.limit + transferDelta;
      return {
        ...b, spent, transferDelta, effectiveLimit,
        pct: effectiveLimit > 0 ? Math.min(100, (spent / effectiveLimit) * 100) : 0,
        over: spent > effectiveLimit,
      };
    });
  }, [budgets, periodTx, categories, categoryTransferNet]);

  const chartData = useMemo(() => {
    const arr = [];
    const pushMonth = (d) => {
      const key = monthKey(d);
      const tx = visibleTx.filter((t) => monthKey(new Date(t.date)) === key && !t.isTransfer);
      const inc = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const exp = Math.abs(tx.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));
      arr.push({ label: d.toLocaleDateString("fr-FR", { month: "short" }), Revenus: inc, Dépenses: exp });
    };
    if (periodMode === "year") {
      for (let m = 0; m < 12; m++) pushMonth(new Date(yearCursor, m, 1));
    } else {
      const [y, m] = monthCursor.split("-").map(Number);
      for (let i = 5; i >= 0; i--) pushMonth(new Date(y, m - 1 - i, 1));
    }
    return arr;
  }, [visibleTx, periodMode, monthCursor, yearCursor]);

  // ---------- Transaction actions ----------
  const addTransaction = (tx) => {
    const amount = tx.type === "expense" ? -Math.abs(tx.amount) : Math.abs(tx.amount);
    const newTx = { id: uid(), date: tx.date, label: tx.label, categoryId: tx.categoryId, accountId: tx.accountId, amount };
    setTransactions((prev) => [newTx, ...prev]);

    if (amount < 0) {
      const topId = topIdOf(categories, tx.categoryId);
      const budget = budgets.find((b) => b.categoryId === topId);
      if (budget) {
        const spentSoFar = periodTx
          .filter((t) => topIdOf(categories, t.categoryId) === topId && t.amount < 0 && !t.isTransfer)
          .reduce((s, t) => s + Math.abs(t.amount), 0) + Math.abs(amount);
        if (spentSoFar > budget.limit) {
          showToast(`⚠️ Budget "${catMeta(categories, topId).name}" dépassé ce mois-ci`);
        }
      }
    }
    setShowAdd(false);
  };

  const deleteTransaction = useCallback((id) => {
    setTransactions((prev) => {
      const tx = prev.find((t) => t.id === id);
      if (!tx) return prev;
      if (tx.isTransfer && tx.transferGroup) {
        return prev.filter((t) => t.transferGroup !== tx.transferGroup);
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const addTransfer = (tr) => {
    const amount = Math.abs(tr.amount);
    const fromAcc = accounts.find((a) => a.id === tr.fromId);
    const toAcc = accounts.find((a) => a.id === tr.toId);
    const virementCat = categories.find((c) => c.isTransferCategory && !c.parentId);
    const groupId = uid();
    const outTx = {
      id: uid(), date: tr.date, label: tr.label || `Virement vers ${toAcc?.name || ""}`,
      categoryId: virementCat?.id, accountId: tr.fromId, amount: -amount, isTransfer: true, transferGroup: groupId,
    };
    const inTx = {
      id: uid(), date: tr.date, label: tr.label || `Virement depuis ${fromAcc?.name || ""}`,
      categoryId: virementCat?.id, accountId: tr.toId, amount: amount, isTransfer: true, transferGroup: groupId,
    };
    setTransactions((prev) => [outTx, inTx, ...prev]);
    showToast(`🔄 ${fmt(amount)} transféré vers ${toAcc?.name || ""}`);
    setShowAdd(false);
  };

  const addAccount = (acc) => {
    setAccounts((prev) => [...prev, { id: uid(), name: acc.name, type: acc.type, initialBalance: Number(acc.balance) || 0, color: acc.color }]);
    setShowAddAccount(false);
  };

  // The ONLY way to change an account's balance "from the outside" is by
  // editing its true starting point. The balance shown everywhere else is
  // always DERIVED as initialBalance + sum(movements) - see accountsWithBalance -
  // so it can never drift out of sync with that formula.
  const setAccountInitialBalance = (id, newInitialBalance) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, initialBalance: Number(newInitialBalance) || 0 } : a)));
    showToast("✅ Solde initial mis à jour");
  };
  const setAccountColor = (id, color) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, color } : a)));
  };

  // ---------- Category transfer actions (budget reallocation, no cash movement) ----------
  const addCategoryTransfer = (tr) => {
    const amount = Math.abs(Number(tr.amount) || 0);
    if (!amount || !tr.fromCategoryId || !tr.toCategoryId || tr.fromCategoryId === tr.toCategoryId) return;
    setCategoryTransfers((prev) => [{
      id: uid(), date: tr.date, fromCategoryId: tr.fromCategoryId, toCategoryId: tr.toCategoryId, amount, note: tr.note || "",
    }, ...prev]);
    showToast("🔀 Budget réalloué entre catégories");
    setShowCategoryTransfer(false);
  };
  const deleteCategoryTransfer = useCallback((id) => {
    setCategoryTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---------- Category actions ----------
  const addCategory = (name, icon, color, nature = "expense") => {
    if (!name.trim()) return;
    setCategories((prev) => [...prev, {
      id: uid(), name: name.trim(), icon: icon || "✨",
      color: color || PALETTE[prev.length % PALETTE.length], parentId: null, nature,
    }]);
  };
  const addSubcategory = (parentId, name, icon) => {
    if (!name.trim()) return;
    const parent = catById(categories, parentId);
    setCategories((prev) => [...prev, { id: uid(), name: name.trim(), icon: icon || parent?.icon || "✨", color: parent?.color || COLORS.textDim, parentId }]);
  };
  const editCategory = (id, updates) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };
  const deleteCategory = (id) => {
    const toRemove = new Set([id, ...categories.filter((c) => c.parentId === id).map((c) => c.id)]);
    setCategories((prev) => prev.filter((c) => !toRemove.has(c.id)));
    setBudgets((prev) => prev.filter((b) => b.categoryId !== id));
    setTransactions((prev) => prev.map((t) => (toRemove.has(t.categoryId) ? { ...t, categoryId: null } : t)));
  };

  // ---------- Google Drive sync ----------
  // Disabled in the standalone app: the original relied on Claude.ai's
  // sandbox injecting an API key server-side. There's no safe way to call
  // the Anthropic API directly from the phone. Data still saves locally on
  // the device (src/storage.js) and CSV/Excel export works below.
  const saveToDrive = async () => {
    setCloudStatus("error");
    showToast("Synchro Drive indisponible dans l'app mobile pour l'instant");
  };

  const loadFromDrive = async () => {
    setCloudStatus("error");
    showToast("Synchro Drive indisponible dans l'app mobile pour l'instant");
  };

  // ---------- Export ----------
  const buildExportRows = () => {
    return transactions
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((t) => {
        const cat = catById(categories, t.categoryId);
        const parent = cat?.parentId ? catById(categories, cat.parentId) : null;
        const acc = accounts.find((a) => a.id === t.accountId);
        const d = new Date(t.date);
        return {
          "Date": t.date,
          "Année": d.getFullYear(),
          "Mois": d.getMonth() + 1,
          "Type": t.isTransfer ? "Virement" : t.amount < 0 ? "Dépense" : "Revenu",
          "Catégorie": parent ? parent.name : (cat?.name || "Autre"),
          "Sous-catégorie": parent ? cat.name : "",
          "Compte": acc?.name || "",
          "Type de compte": acc?.type || "",
          "Description": t.label || "",
          "Montant": t.amount,
          "Montant absolu": Math.abs(t.amount),
          "Devise": "MAD",
          "ID transaction": t.id,
        };
      });
  };

  // Exports use the native Share sheet on Android (via Filesystem + Share
  // plugins) and fall back to a plain browser download when running as a
  // regular web page (e.g. `npm run dev`).
  const shareOrDownload = async (filename, data, { base64 = false, mimeType } = {}) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const written = await Filesystem.writeFile({
          path: filename,
          data,
          directory: Directory.Cache,
          ...(base64 ? {} : { encoding: "utf8" }),
        });
        await Share.share({ title: filename, url: written.uri, dialogTitle: "Partager le fichier" });
      } catch (e) {
        showToast("Erreur lors de l'export du fichier");
      }
      return;
    }
    let blob;
    if (base64) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: mimeType });
    } else {
      blob = new Blob([data], { type: mimeType });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = async () => {
    const rows = buildExportRows();
    if (rows.length === 0) { showToast("Aucune donnée à exporter"); return; }
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(";"), ...rows.map((r) => headers.map((h) => esc(r[h])).join(";"))].join("\n");
    await shareOrDownload("budgetbacker-transactions.csv", "\uFEFF" + csv, { mimeType: "text/csv;charset=utf-8;" });
    showToast("📄 CSV exporté");
  };

  const exportExcel = async () => {
    const rows = buildExportRows();
    if (rows.length === 0) { showToast("Aucune donnée à exporter"); return; }
    const wb = XLSX.utils.book_new();
    const wsTx = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsTx, "Transactions");
    const wsAcc = XLSX.utils.json_to_sheet(accountsWithBalance.map((a) => ({ Nom: a.name, Type: a.type, Solde: a.balance })));
    XLSX.utils.book_append_sheet(wb, wsAcc, "Comptes");
    const wsBudgets = XLSX.utils.json_to_sheet(budgets.map((b) => ({ Catégorie: catMeta(categories, b.categoryId).name, Limite: b.limit })));
    XLSX.utils.book_append_sheet(wb, wsBudgets, "Budgets");
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    await shareOrDownload("budgetbacker-export.xlsx", base64, {
      base64: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    showToast("📊 Excel exporté");
  };

  if (!ready) {
    return (
      <div style={{ background: COLORS.bg, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textDim, fontFamily: "system-ui" }}>
        Chargement…
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      background: COLORS.bg, color: COLORS.text, height: "100dvh", width: "100%",
      display: "flex", flexDirection: "column", overflow: "hidden", position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        html, body { overscroll-behavior: none; }
        .scrollarea::-webkit-scrollbar { display: none; }
        .hscroll::-webkit-scrollbar { display: none; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "calc(24px + env(safe-area-inset-top)) 20px 16px", background: `linear-gradient(160deg, ${COLORS.surface2}, ${COLORS.bg})`, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: COLORS.textDim, letterSpacing: "0.06em", textTransform: "uppercase" }}>Vos comptes</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title="Changer de thème"
              style={{
                width: 36, height: 36, borderRadius: "50%", background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.gold,
              }}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: COLORS.gold, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: COLORS.bg, fontSize: 15 }}>
              💼
            </div>
          </div>
        </div>

        {/* Account dials */}
        <div className="hscroll" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
          {accountsWithBalance.map((a) => (
            <AccountDial
              key={a.id} a={a} theme={theme}
              isSelected={selectedAccountIds.includes(a.id)}
              onPressStart={handleAccountPressStart}
              onPressEnd={handleAccountPressEnd}
              onPressCancel={handleAccountPressCancel}
            />
          ))}
        </div>
        {selectedAccountIds.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <div style={{ fontSize: 11, color: COLORS.gold }}>
              {selectedAccountIds.length === 1 ? "1 compte sélectionné" : `${selectedAccountIds.length} comptes sélectionnés`}
              <span style={{ color: COLORS.textDim }}> · appui long pour en ajouter</span>
            </div>
            <button onClick={() => setSelectedAccountIds([])} style={{ background: "none", border: "none", color: COLORS.textDim, fontSize: 11, textDecoration: "underline" }}>
              Tout afficher
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="scrollarea" style={{ flex: 1, overflowY: "auto", padding: "16px 20px calc(90px + env(safe-area-inset-bottom))", scrollbarWidth: "none" }}>
        {tab !== "accounts" && (
          <PeriodSelector
            mode={periodMode} setMode={setPeriodMode} label={periodLabel}
            onPrev={() => (periodMode === "year" ? shiftYear(-1) : shiftMonth(-1))}
            onNext={() => (periodMode === "year" ? shiftYear(1) : shiftMonth(1))}
          />
        )}
        {tab === "home" && (
          <HomeTab byCategory={byCategory} periodTx={periodTx} categories={categories} periodLabel={periodLabel} onDelete={deleteTransaction} theme={theme} />
        )}
        {tab === "transactions" && (
          <TransactionsTab transactions={periodTx} categories={categories} onDelete={deleteTransaction} theme={theme} />
        )}
        {tab === "budgets" && (
          <BudgetsTab budgetStatus={budgetStatus} setBudgets={setBudgets} categories={categories} onOpenCategoryTransfer={() => setShowCategoryTransfer(true)} />
        )}
        {tab === "stats" && (
          <StatsTab chartData={chartData} periodMode={periodMode} byCategory={byCategory} periodTx={periodTx} categories={categories} />
        )}
        {tab === "accounts" && (
          <AccountsTab
            accounts={accountsWithBalance}
            onAdd={() => setShowAddAccount(true)}
            onOpenDetail={setAccountDetailId}
            onOpenTransfersHistory={() => setShowTransfersHistory(true)}
            cloudStatus={cloudStatus}
            lastSynced={lastSynced}
            onSaveDrive={saveToDrive}
            onLoadDrive={loadFromDrive}
            onExportCSV={exportCSV}
            onExportExcel={exportExcel}
            categories={categories}
            onAddCategory={addCategory}
            onEditCategory={editCategory}
            onAddSubcategory={addSubcategory}
            onDeleteCategory={deleteCategory}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "absolute", top: 12, left: 20, right: 20, background: COLORS.coral, color: "#1B0E09",
          padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 40,
          display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}>
          <AlertTriangle size={16} /> {toast}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        style={{
          position: "absolute", bottom: "calc(78px + env(safe-area-inset-bottom))", right: 20, width: 54, height: 54, borderRadius: "50%",
          background: COLORS.gold, border: "none", color: COLORS.bg, display: "flex", alignItems: "center",
          justifyContent: "center", boxShadow: "0 8px 20px rgba(201,151,76,0.4)", zIndex: 30,
        }}
      >
        <Plus size={26} />
      </button>

      {/* Bottom nav */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "calc(64px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)", background: COLORS.surface,
        borderTop: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-around",
      }}>
        <NavBtn icon={Home} label="Accueil" active={tab === "home"} onClick={() => setTab("home")} theme={theme} />
        <NavBtn icon={List} label="Historique" active={tab === "transactions"} onClick={() => setTab("transactions")} theme={theme} />
        <NavBtn icon={Wallet} label="Budgets" active={tab === "budgets"} onClick={() => setTab("budgets")} theme={theme} />
        <NavBtn icon={PieIcon} label="Stats" active={tab === "stats"} onClick={() => setTab("stats")} theme={theme} />
        <NavBtn icon={Landmark} label="Comptes" active={tab === "accounts"} onClick={() => setTab("accounts")} theme={theme} />
      </div>

      {showAdd && (
        <AddTransactionModal
          accounts={accountsWithBalance}
          formAccounts={selectedAccountIds.length > 0 ? accountsWithBalance.filter((a) => selectedAccountIds.includes(a.id)) : accountsWithBalance}
          categories={categories}
          onClose={() => setShowAdd(false)} onSave={addTransaction} onTransfer={addTransfer}
        />
      )}
      {showAddAccount && <AddAccountModal onClose={() => setShowAddAccount(false)} onSave={addAccount} />}
      {accountDetailId && (
        <AccountDetailModal
          account={accountsWithBalance.find((a) => a.id === accountDetailId)}
          onClose={() => setAccountDetailId(null)}
          onSaveInitialBalance={setAccountInitialBalance}
          onSaveColor={setAccountColor}
        />
      )}
      {showCategoryTransfer && (
        <CategoryTransferModal
          categories={categories}
          onClose={() => setShowCategoryTransfer(false)}
          onSave={addCategoryTransfer}
        />
      )}
      {showTransfersHistory && (
        <TransfersHistoryModal
          accountTransfers={accountTransferGroups}
          categoryTransfers={categoryTransfers}
          categories={categories}
          onClose={() => setShowTransfersHistory(false)}
          onDeleteAccountTransfer={deleteTransaction}
          onDeleteCategoryTransfer={deleteCategoryTransfer}
        />
      )}
    </div>
  );
}

const AccountDial = React.memo(function AccountDial({ a, isSelected, onPressStart, onPressEnd, onPressCancel, theme }) {
  const [pressed, setPressed] = useState(false);
  const Icon = ACCOUNT_ICONS[a.type] || Landmark;
  const base = a.color || getAccountColor(a.type);
  const light = shadeColor(base, 22);
  const dark = shadeColor(base, -26);

  return (
    <button
      onPointerDown={() => { setPressed(true); onPressStart(a.id); }}
      onPointerUp={() => { setPressed(false); onPressEnd(a.id); }}
      onPointerLeave={() => { setPressed(false); onPressCancel(); }}
      onPointerCancel={() => { setPressed(false); onPressCancel(); }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        minWidth: 132, flexShrink: 0, textAlign: "left", position: "relative", borderRadius: 16,
        padding: "13px 14px", border: `1.5px solid ${isSelected ? COLORS.gold : "rgba(255,255,255,0.14)"}`,
        background: `linear-gradient(155deg, ${light}, ${base} 55%, ${dark})`,
        boxShadow: pressed
          ? "inset 0 2px 5px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.2)"
          : "0 5px 12px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.35)",
        transform: pressed ? "translateY(1px) scale(0.99)" : "translateY(0) scale(1)",
        transition: "transform 0.08s ease, box-shadow 0.08s ease",
        userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation",
      }}
    >
      {isSelected && (
        <div style={{ position: "absolute", top: 8, right: 8, width: 14, height: 14, borderRadius: "50%", background: COLORS.gold, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check size={9} color={COLORS.bg} strokeWidth={3} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
          <Icon size={12} />
        </div>
        <span style={{ color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 5, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{fmt(a.balance)}</div>
    </button>
  );
});

const NavBtn = React.memo(function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center",
      gap: 3, color: active ? COLORS.gold : COLORS.textDim, fontSize: 10, padding: "4px 6px",
    }}>
      <div style={{
        width: 30, height: 22, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
        background: active ? `${COLORS.gold}22` : "transparent", transition: "background 0.2s",
      }}>
        <Icon size={18} />
      </div>
      {label}
    </button>
  );
});

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 10px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</div>
      {right}
    </div>
  );
}

const PeriodSelector = React.memo(function PeriodSelector({ mode, setMode, label, onPrev, onNext }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", background: COLORS.surface, borderRadius: 10, padding: 2, border: `1px solid ${COLORS.border}` }}>
        {[["month", "Mois"], ["year", "Année"]].map(([val, lab]) => (
          <button key={val} onClick={() => setMode(val)} style={{
            padding: "5px 12px", borderRadius: 8, border: "none", fontSize: 11.5, fontWeight: 600,
            background: mode === val ? COLORS.gold : "transparent", color: mode === val ? COLORS.bg : COLORS.textDim,
          }}>{lab}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onPrev} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "50%", width: 26, height: 26, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft size={13} />
        </button>
        <div style={{ fontSize: 12.5, fontWeight: 600, textTransform: "capitalize", minWidth: 92, textAlign: "center" }}>{label}</div>
        <button onClick={onNext} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "50%", width: 26, height: 26, color: COLORS.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
});

function HomeTab({ byCategory, periodTx, categories, periodLabel, onDelete, theme }) {
  const total = byCategory.reduce((s, c) => s + c.value, 0);
  return (
    <div>
      <div style={{ fontSize: 13, color: COLORS.textDim, textTransform: "capitalize" }}>{periodLabel}</div>
      {byCategory.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <div style={{ width: 130, height: 130, position: "relative", flexShrink: 0 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={byCategory} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2}>
                  {byCategory.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", pointerEvents: "none",
            }}>
              <div style={{ fontSize: 10, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.04em" }}>Dépensé</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{fmt(total)}</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {byCategory.slice(0, 4).map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, color: COLORS.text, minWidth: 0 }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: `${c.color}26`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
                  }}>{c.icon}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, marginLeft: 6 }}>
                  <span style={{ color: COLORS.text, fontWeight: 600 }}>{fmt(c.value)}</span>
                  <span style={{ color: COLORS.textDim, fontSize: 10 }}>{total > 0 ? Math.round((c.value / total) * 100) : 0}%</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState icon={PieIcon} text="Aucune dépense ce mois-ci. Touchez + pour en ajouter une." />
      )}

      <SectionTitle>Transactions récentes</SectionTitle>
      {periodTx.length === 0 && <EmptyState icon={List} text="Rien à afficher pour l'instant." />}
      {periodTx.slice(0, 6).map((t) => (
        <TxRow key={t.id} t={t} categories={categories} onDelete={onDelete} theme={theme} />
      ))}
    </div>
  );
}

function TransactionsTab({ transactions, categories, onDelete, theme }) {
  return (
    <div>
      <SectionTitle>Transactions de la période</SectionTitle>
      {transactions.length === 0 && <EmptyState icon={List} text="Aucune transaction sur cette période. Ajoutez-en une avec le bouton +." />}
      {transactions.map((t) => <TxRow key={t.id} t={t} categories={categories} onDelete={onDelete} showDate theme={theme} />)}
    </div>
  );
}

const TxRow = React.memo(function TxRow({ t, categories, onDelete, showDate }) {
  const meta = catMeta(categories, t.categoryId);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${meta.color}26`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
        {meta.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label || meta.name}</div>
        <div style={{ fontSize: 11, color: COLORS.textDim }}>
          {catLabel(categories, t.categoryId)}{showDate ? ` · ${new Date(t.date).toLocaleDateString("fr-FR")}` : ""}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: t.isTransfer ? COLORS.sky : t.amount < 0 ? COLORS.coral : COLORS.mint }}>
        {t.amount < 0 ? "-" : "+"}{fmt(Math.abs(t.amount))}
      </div>
      <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", color: COLORS.textDim, padding: 4 }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
});

function BudgetsTab({ budgetStatus, setBudgets, categories, onOpenCategoryTransfer }) {
  const [editing, setEditing] = useState(null);
  const topCats = categories.filter((c) => !c.parentId && c.nature !== "income" && !c.isTransferCategory);

  const addCategoryBudget = (catId) => {
    if (budgetStatus.some((b) => b.categoryId === catId)) return;
    setBudgets((prev) => [...prev, { id: uid(), categoryId: catId, limit: 100 }]);
  };
  const updateLimit = (id, val) => {
    setBudgets((prev) => prev.map((b) => (b.id === id ? { ...b, limit: Number(val) || 0 } : b)));
  };
  const removeBudget = (id) => setBudgets((prev) => prev.filter((b) => b.id !== id));

  const unused = topCats.filter((c) => !budgetStatus.some((b) => b.categoryId === c.id));

  return (
    <div>
      <SectionTitle right={
        <button onClick={onOpenCategoryTransfer} style={{ background: "none", border: "none", color: COLORS.gold, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <ArrowLeftRight size={13} /> Transférer
        </button>
      }>Budgets du mois</SectionTitle>
      {budgetStatus.length === 0 && <EmptyState icon={Wallet} text="Aucun budget défini." />}
      {budgetStatus.map((b) => {
        const meta = catMeta(categories, b.categoryId);
        return (
          <div key={b.id} style={{
            background: COLORS.surface, border: `1px solid ${b.over ? COLORS.coral : COLORS.border}`, borderRadius: 14,
            padding: 12, marginBottom: 10, boxShadow: b.over ? `0 0 0 1px ${COLORS.coral}33` : "none",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 8, background: `${meta.color}26`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0,
                }}>{meta.icon}</span>
                {meta.name}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {editing === b.id ? (
                  <input
                    autoFocus type="number" defaultValue={b.limit}
                    onBlur={(e) => { updateLimit(b.id, e.target.value); setEditing(null); }}
                    onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                    style={{ width: 60, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: "2px 6px", fontSize: 12 }}
                  />
                ) : (
                  <span onClick={() => setEditing(b.id)} style={{ fontSize: 12, color: b.over ? COLORS.coral : COLORS.textDim, cursor: "pointer", fontWeight: b.over ? 600 : 400 }}>
                    {fmt(b.spent)} / {fmt(b.effectiveLimit)}
                  </span>
                )}
                <button onClick={() => removeBudget(b.id)} style={{ background: "none", border: "none", color: COLORS.textDim }}><Trash2 size={13} /></button>
              </div>
            </div>
            <div style={{ height: 7, background: COLORS.surface2, borderRadius: 6, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${b.pct}%`, borderRadius: 6, transition: "width 0.3s",
                background: b.over ? `linear-gradient(90deg, ${COLORS.coral}, #ff8a6b)` : `linear-gradient(90deg, ${meta.color}, ${meta.color}CC)`,
              }} />
            </div>
            {b.transferDelta !== 0 && (
              <div style={{ fontSize: 10.5, color: b.transferDelta > 0 ? COLORS.mint : COLORS.coral, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                <ArrowLeftRight size={11} /> Plafond de base {fmt(b.limit)} {b.transferDelta > 0 ? "+" : "−"} {fmt(Math.abs(b.transferDelta))} (transfert)
              </div>
            )}
            {b.over && <div style={{ fontSize: 11, color: COLORS.coral, marginTop: 6, display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}><AlertTriangle size={12} /> Budget dépassé</div>}
          </div>
        );
      })}

      {unused.length > 0 && (
        <>
          <SectionTitle>Ajouter un budget</SectionTitle>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {unused.map((c) => (
              <button key={c.id} onClick={() => addCategoryBudget(c.id)} style={{
                background: `${c.color}18`, border: `1px solid ${c.color}55`, color: COLORS.text,
                borderRadius: 20, padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6,
              }}>
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatsTab({ chartData, periodMode, byCategory, periodTx, categories }) {
  const [drillId, setDrillId] = useState(null);

  const subBreakdown = useMemo(() => {
    if (!drillId) return [];
    const map = {};
    periodTx.filter((t) => t.amount < 0 && !t.isTransfer).forEach((t) => {
      const cat = catById(categories, t.categoryId);
      const top = topIdOf(categories, t.categoryId);
      if (top !== drillId) return;
      const key = cat?.parentId ? cat.id : "__direct__";
      const label = cat?.parentId ? cat.name : "Non classé (catégorie principale)";
      if (!map[key]) map[key] = { name: label, value: 0, icon: cat?.icon || "✨" };
      map[key].value += Math.abs(t.amount);
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [drillId, periodTx, categories]);

  const drillMeta = drillId ? catMeta(categories, drillId) : null;

  return (
    <div>
      <SectionTitle>Revenus vs Dépenses {periodMode === "year" ? "(12 mois)" : "(6 mois)"}</SectionTitle>
      <div style={{ height: 170 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <XAxis dataKey="label" stroke={COLORS.textDim} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: `${COLORS.textDim}14` }}
              contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: COLORS.text }}
            />
            <Bar dataKey="Revenus" fill={COLORS.mint} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Dépenses" fill={COLORS.coral} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: -4, marginBottom: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.textDim }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: COLORS.mint, display: "inline-block" }} /> Revenus
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.textDim }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: COLORS.coral, display: "inline-block" }} /> Dépenses
        </span>
      </div>

      {!drillId ? (
        <>
          <SectionTitle>Répartition par catégorie</SectionTitle>
          {byCategory.length === 0 && <EmptyState icon={PieIcon} text="Pas encore de dépenses ce mois-ci." />}
          {byCategory.map((c) => {
            const hasSub = categories.some((cc) => cc.parentId === c.id);
            return (
              <button
                key={c.id}
                onClick={() => hasSub && setDrillId(c.id)}
                style={{
                  display: "block", width: "100%", background: "none", border: "none", padding: 0,
                  marginBottom: 12, textAlign: "left", cursor: hasSub ? "pointer" : "default",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.text }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 7, background: `${c.color}26`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0,
                    }}>{c.icon}</span>
                    {c.name}
                  </span>
                  <span style={{ color: COLORS.textDim, display: "flex", alignItems: "center", gap: 4 }}>
                    {fmt(c.value)} {hasSub && <ChevronRight size={13} />}
                  </span>
                </div>
                <div style={{ height: 7, background: COLORS.surface2, borderRadius: 6 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (c.value / (byCategory[0]?.value || 1)) * 100)}%`, background: c.color, borderRadius: 6 }} />
                </div>
              </button>
            );
          })}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 10px" }}>
            <button onClick={() => setDrillId(null)} style={{ background: COLORS.surface2, border: "none", color: COLORS.text, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronLeft size={15} />
            </button>
            <div style={{
              width: 24, height: 24, borderRadius: 7, background: `${drillMeta.color}26`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
            }}>{drillMeta.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{drillMeta.name} · sous-catégories</div>
          </div>
          {subBreakdown.length === 0 && <EmptyState icon={Layers} text="Pas de détail par sous-catégorie ce mois-ci." />}
          {subBreakdown.map((s, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 5 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 7, background: `${drillMeta.color}26`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0,
                  }}>{s.icon}</span>
                  {s.name}
                </span>
                <span style={{ color: COLORS.textDim }}>{fmt(s.value)}</span>
              </div>
              <div style={{ height: 7, background: COLORS.surface2, borderRadius: 6 }}>
                <div style={{ height: "100%", width: `${Math.min(100, (s.value / (subBreakdown[0]?.value || 1)) * 100)}%`, background: drillMeta.color, borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AccountsTab({
  accounts, onAdd, onOpenDetail, onOpenTransfersHistory, cloudStatus, lastSynced, onSaveDrive, onLoadDrive, onExportCSV, onExportExcel,
  categories, onAddCategory, onEditCategory, onAddSubcategory, onDeleteCategory,
}) {
  const statusLabel = {
    idle: "Pas encore synchronisé",
    syncing: "Synchronisation…",
    synced: lastSynced ? `Dernière sync : ${lastSynced.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Synchronisé",
    error: "Échec de synchronisation",
  }[cloudStatus];

  return (
    <div>
      <SectionTitle>Sauvegarde cloud</SectionTitle>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: cloudStatus === "error" ? `${COLORS.coral}26` : cloudStatus === "synced" ? `${COLORS.mint}26` : `${COLORS.gold}26`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: cloudStatus === "error" ? COLORS.coral : cloudStatus === "synced" ? COLORS.mint : COLORS.gold,
          }}>
            <Cloud size={18} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Google Drive</div>
            <div style={{ fontSize: 11, color: COLORS.textDim }}>{statusLabel}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onSaveDrive} disabled={cloudStatus === "syncing"} style={{
            flex: 1, background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 10,
            padding: "9px 0", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, opacity: cloudStatus === "syncing" ? 0.6 : 1,
          }}>
            <CloudUpload size={14} /> Sauvegarder
          </button>
          <button onClick={onLoadDrive} disabled={cloudStatus === "syncing"} style={{
            flex: 1, background: "transparent", border: `1.5px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 10,
            padding: "9px 0", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, opacity: cloudStatus === "syncing" ? 0.6 : 1,
          }}>
            <CloudDownload size={14} /> Restaurer
          </button>
        </div>
      </div>

      <SectionTitle>Exporter les données</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button onClick={onExportExcel} style={{
          flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 12,
          padding: "12px 0", fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        }}>
          <FileSpreadsheet size={18} color={COLORS.mint} /> Excel (.xlsx)
        </button>
        <button onClick={onExportCSV} style={{
          flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 12,
          padding: "12px 0", fontSize: 12.5, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        }}>
          <FileDown size={18} color={COLORS.sky} /> CSV
        </button>
      </div>

      <CategoryManager categories={categories} onAdd={onAddCategory} onEdit={onEditCategory} onAddSub={onAddSubcategory} onDelete={onDeleteCategory} />

      <SectionTitle right={
        <button onClick={onOpenTransfersHistory} style={{ background: "none", border: "none", color: COLORS.gold, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <History size={13} /> Historique
        </button>
      }>Vos comptes</SectionTitle>
      {accounts.map((a) => {
        const Icon = ACCOUNT_ICONS[a.type] || Landmark;
        const accColor = a.color || getAccountColor(a.type);
        return (
          <button key={a.id} onClick={() => onOpenDetail(a.id)} style={{
            display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 12, marginBottom: 10,
          }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `${accColor}26`, display: "flex", alignItems: "center", justifyContent: "center", color: accColor, flexShrink: 0 }}>
              <Icon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{a.name}</div>
              <div style={{ fontSize: 11, color: COLORS.textDim }}>{a.type}</div>
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>{fmt(a.balance)}</span>
            <ChevronRight size={15} color={COLORS.textDim} />
          </button>
        );
      })}
      <div style={{ fontSize: 10.5, color: COLORS.textDim, marginTop: -4, marginBottom: 10 }}>
        Touchez un compte pour voir le détail et corriger son solde initial si besoin.
      </div>
      <button onClick={onAdd} style={{
        width: "100%", marginTop: 6, background: "none", border: `1.5px dashed ${COLORS.border}`,
        color: COLORS.textDim, borderRadius: 14, padding: 14, fontSize: 13, display: "flex",
        alignItems: "center", justifyContent: "center", gap: 8,
      }}>
        <Plus size={16} /> Ajouter un compte
      </button>
    </div>
  );
}

function NatureToggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      {[["expense", "Dépense", COLORS.coral], ["income", "Revenu", COLORS.mint]].map(([val, lab, col]) => (
        <button key={val} onClick={() => onChange(val)} style={{
          flex: 1, padding: "7px 0", borderRadius: 8, border: `1.5px solid ${value === val ? col : COLORS.border}`,
          background: value === val ? `${col}22` : "transparent", color: value === val ? col : COLORS.textDim,
          fontWeight: 600, fontSize: 11.5,
        }}>{lab}</button>
      ))}
    </div>
  );
}

function CategoryManager({ categories, onAdd, onEdit, onAddSub, onDelete }) {
  const [expanded, setExpanded] = useState(null);
  const [newTop, setNewTop] = useState(false);
  const [topName, setTopName] = useState("");
  const [topIcon, setTopIcon] = useState("");
  const [topColor, setTopColor] = useState(PALETTE[0]);
  const [topNature, setTopNature] = useState("expense");
  const [subFor, setSubFor] = useState(null);
  const [subName, setSubName] = useState("");
  const [subIcon, setSubIcon] = useState("");
  const [editTopId, setEditTopId] = useState(null);
  const [editTopName, setEditTopName] = useState("");
  const [editTopIcon, setEditTopIcon] = useState("");
  const [editTopColor, setEditTopColor] = useState(PALETTE[0]);
  const [editTopNature, setEditTopNature] = useState("expense");
  const [editSubId, setEditSubId] = useState(null);
  const [editSubName, setEditSubName] = useState("");
  const [editSubIcon, setEditSubIcon] = useState("");

  const tops = categories.filter((c) => !c.parentId);

  const submitTop = () => {
    if (!topName.trim()) return;
    onAdd(topName, topIcon, topColor, topNature);
    setTopName(""); setTopIcon(""); setTopColor(PALETTE[0]); setTopNature("expense"); setNewTop(false);
  };
  const submitSub = (parentId) => {
    if (!subName.trim()) return;
    onAddSub(parentId, subName, subIcon);
    setSubName(""); setSubIcon(""); setSubFor(null);
  };
  const startEditTop = (c) => {
    setEditTopId(c.id); setEditTopName(c.name); setEditTopIcon(c.icon);
    setEditTopColor(c.color); setEditTopNature(c.nature === "income" ? "income" : "expense");
  };
  const submitEditTop = () => {
    if (!editTopName.trim()) return;
    onEdit(editTopId, { name: editTopName.trim(), icon: editTopIcon || "✨", color: editTopColor, nature: editTopNature });
    setEditTopId(null);
  };
  const startEditSub = (s) => { setEditSubId(s.id); setEditSubName(s.name); setEditSubIcon(s.icon); };
  const submitEditSub = () => {
    if (!editSubName.trim()) return;
    onEdit(editSubId, { name: editSubName.trim(), icon: editSubIcon || "✨" });
    setEditSubId(null);
  };

  return (
    <>
      <SectionTitle right={
        <button onClick={() => { setNewTop((v) => !v); setEditTopId(null); }} style={{ background: "none", border: "none", color: COLORS.gold, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={13} /> Catégorie
        </button>
      }>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Tags size={13} /> Catégories</span>
      </SectionTitle>

      {newTop && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={topIcon} onChange={(e) => setTopIcon(e.target.value)} placeholder="🏷️" maxLength={2}
              style={{ width: 44, textAlign: "center", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "8px 0", fontSize: 15 }} />
            <input value={topName} onChange={(e) => setTopName(e.target.value)} placeholder="Nom de la catégorie"
              style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "8px 10px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {PALETTE.map((c) => (
              <button key={c} onClick={() => setTopColor(c)} style={{
                width: 20, height: 20, borderRadius: "50%", background: c, border: topColor === c ? `2px solid ${COLORS.text}` : "2px solid transparent",
              }} />
            ))}
          </div>
          <NatureToggle value={topNature} onChange={setTopNature} />
          <button onClick={submitTop} style={{ width: "100%", marginTop: 10, background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 8, padding: "8px 0", fontSize: 12.5, fontWeight: 700 }}>
            Ajouter
          </button>
        </div>
      )}

      {tops.map((c) => {
        const subs = categories.filter((s) => s.parentId === c.id);
        const isOpen = expanded === c.id;
        const isEditingTop = editTopId === c.id;
        const isCore = !!c.isTransferCategory;
        return (
          <div key={c.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, marginBottom: 8, overflow: "hidden", borderLeft: `3px solid ${c.color}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
              <button onClick={() => setExpanded(isOpen ? null : c.id)} style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 8, flex: 1, color: COLORS.text, textAlign: "left" }}>
                {isOpen ? <ChevronLeft size={13} style={{ transform: "rotate(-90deg)" }} /> : <ChevronRight size={13} />}
                <span style={{
                  width: 22, height: 22, borderRadius: 7, background: `${c.color}26`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0,
                }}>{c.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                {!c.isTransferCategory && (
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 20, textTransform: "uppercase",
                    color: c.nature === "income" ? COLORS.mint : COLORS.coral,
                    background: c.nature === "income" ? `${COLORS.mint}1F` : `${COLORS.coral}1F`,
                  }}>{c.nature === "income" ? "Revenu" : "Dépense"}</span>
                )}
                {subs.length > 0 && <span style={{ fontSize: 10.5, color: COLORS.textDim }}>({subs.length})</span>}
              </button>
              {!c.isTransferCategory && (
                <button onClick={() => { setNewTop(false); startEditTop(c); }} style={{ background: "none", border: "none", color: COLORS.textDim }}>
                  <Pencil size={13} />
                </button>
              )}
              {!isCore && (
                <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: COLORS.textDim }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {isEditingTop && (
              <div style={{ padding: "0 12px 12px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={editTopIcon} onChange={(e) => setEditTopIcon(e.target.value)} placeholder="🏷️" maxLength={2}
                    style={{ width: 44, textAlign: "center", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "8px 0", fontSize: 15 }} />
                  <input value={editTopName} onChange={(e) => setEditTopName(e.target.value)} placeholder="Nom de la catégorie"
                    style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "8px 10px", fontSize: 13 }} />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {PALETTE.map((col) => (
                    <button key={col} onClick={() => setEditTopColor(col)} style={{
                      width: 20, height: 20, borderRadius: "50%", background: col, border: editTopColor === col ? `2px solid ${COLORS.text}` : "2px solid transparent",
                    }} />
                  ))}
                </div>
                <NatureToggle value={editTopNature} onChange={setEditTopNature} />
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button onClick={() => setEditTopId(null)} style={{ flex: 1, background: COLORS.surface2, border: "none", color: COLORS.text, borderRadius: 8, padding: "8px 0", fontSize: 12.5, fontWeight: 600 }}>
                    Annuler
                  </button>
                  <button onClick={submitEditTop} style={{ flex: 1, background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 8, padding: "8px 0", fontSize: 12.5, fontWeight: 700 }}>
                    Enregistrer
                  </button>
                </div>
              </div>
            )}

            {isOpen && (
              <div style={{ padding: "0 12px 12px 34px" }}>
                {subs.map((s) => (
                  editSubId === s.id ? (
                    <div key={s.id} style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 6 }}>
                      <input value={editSubIcon} onChange={(e) => setEditSubIcon(e.target.value)} placeholder="🏷️" maxLength={2}
                        style={{ width: 38, textAlign: "center", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "6px 0", fontSize: 13 }} />
                      <input value={editSubName} onChange={(e) => setEditSubName(e.target.value)} autoFocus
                        onKeyDown={(e) => e.key === "Enter" && submitEditSub()}
                        style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "6px 10px", fontSize: 12.5 }} />
                      <button onClick={submitEditSub} style={{ background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 700 }}>OK</button>
                    </div>
                  ) : (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12.5, color: COLORS.textDim }}>
                      <span>{s.icon}</span><span style={{ flex: 1 }}>{s.name}</span>
                      <button onClick={() => startEditSub(s)} style={{ background: "none", border: "none", color: COLORS.textDim }}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => onDelete(s.id)} style={{ background: "none", border: "none", color: COLORS.textDim }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                ))}
                {subFor === c.id ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <input value={subIcon} onChange={(e) => setSubIcon(e.target.value)} placeholder="🏷️" maxLength={2}
                      style={{ width: 38, textAlign: "center", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "6px 0", fontSize: 13 }} />
                    <input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Sous-catégorie" autoFocus
                      onKeyDown={(e) => e.key === "Enter" && submitSub(c.id)}
                      style={{ flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: "6px 10px", fontSize: 12.5 }} />
                    <button onClick={() => submitSub(c.id)} style={{ background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 8, padding: "0 10px", fontSize: 12, fontWeight: 700 }}>OK</button>
                  </div>
                ) : (
                  <button onClick={() => setSubFor(c.id)} style={{ background: "none", border: "none", color: COLORS.gold, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <Plus size={12} /> Sous-catégorie
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function EmptyState({ text, icon: Icon = Wallet }) {
  return (
    <div style={{ textAlign: "center", padding: "26px 10px" }}>
      <div style={{
        width: 44, height: 44, borderRadius: "50%", background: COLORS.surface2, color: COLORS.textDim,
        display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px",
      }}>
        <Icon size={20} />
      </div>
      <div style={{ fontSize: 12.5, color: COLORS.textDim }}>{text}</div>
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, display: "flex", alignItems: "flex-end" }}>
      <div style={{
        background: COLORS.surface, width: "100%", borderRadius: "22px 22px 0 0",
        padding: "20px 20px max(28px, calc(env(safe-area-inset-bottom, 0px) + 20px))",
        maxHeight: "85%", overflowY: "auto", boxSizing: "border-box",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: COLORS.surface2, border: "none", color: COLORS.text, borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} />
          </button>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function fieldStyle() {
  return { width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.text, padding: "10px 12px", fontSize: 13.5, marginTop: 4 };
}
function labelStyle() {
  return { fontSize: 11.5, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.04em" };
}

function AccountDetailModal({ account, onClose, onSaveInitialBalance, onSaveColor }) {
  const [value, setValue] = useState(account ? String(account.initialBalance || 0) : "0");
  const [color, setColor] = useState(account ? (account.color || getAccountColor(account.type)) : PALETTE[0]);
  if (!account) return null;
  const movements = account.balance - (account.initialBalance || 0);
  const Icon = ACCOUNT_ICONS[account.type] || Landmark;
  const accColor = getAccountColor(account.type);

  return (
    <ModalShell title={account.name} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${accColor}26`, display: "flex", alignItems: "center", justifyContent: "center", color: accColor, flexShrink: 0 }}>
          <Icon size={20} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.textDim }}>{account.type}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmt(account.balance)}</div>
        </div>
      </div>

      <div style={{ background: COLORS.surface2, borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 12, color: COLORS.textDim }}>
        Solde actuel = solde initial {movements >= 0 ? "+" : "−"} mouvements ({fmt(Math.abs(movements))})
      </div>

      <label style={labelStyle()}>Solde initial</label>
      <input
        style={fieldStyle()} type="number" value={value} onChange={(e) => setValue(e.target.value)}
      />
      <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 6 }}>
        Modifier cette valeur recalcule automatiquement le solde actuel ci-dessus (il reste toujours égal au solde initial ± les mouvements déjà enregistrés).
      </div>

      <label style={{ ...labelStyle(), display: "block", marginTop: 16 }}>Couleur du cadran</label>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {PALETTE.map((c) => (
          <button key={c} onClick={() => setColor(c)} style={{
            width: 26, height: 26, borderRadius: "50%", background: c,
            border: color === c ? `2px solid ${COLORS.text}` : "2px solid transparent",
            boxShadow: color === c ? `0 0 0 2px ${COLORS.bg}` : "none",
          }} />
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex" }}>
        <AccountDial a={{ ...account, color }} isSelected={false} onPressStart={() => {}} onPressEnd={() => {}} onPressCancel={() => {}} />
      </div>

      <button
        onClick={() => { onSaveInitialBalance(account.id, value); onSaveColor(account.id, color); onClose(); }}
        style={{ width: "100%", marginTop: 16, background: COLORS.gold, border: "none", color: COLORS.bg, borderRadius: 12, padding: "13px 0", fontSize: 14, fontWeight: 700 }}
      >
        Enregistrer
      </button>
    </ModalShell>
  );
}

function CategoryTransferModal({ categories, onClose, onSave }) {
  const topCats = categories.filter((c) => !c.parentId && !c.isTransferCategory);
  const [fromCategoryId, setFromCategoryId] = useState(topCats[0]?.id || "");
  const [toCategoryId, setToCategoryId] = useState(topCats[1]?.id || topCats[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const canSave = amount && Number(amount) > 0 && fromCategoryId && toCategoryId && fromCategoryId !== toCategoryId;

  return (
    <ModalShell title="Transférer entre catégories" onClose={onClose}>
      <div style={{ fontSize: 11.5, color: COLORS.textDim, marginBottom: 14, lineHeight: 1.5 }}>
        Réalloue une part de plafond budgétaire d'une catégorie vers une autre pour la période en cours.
        Aucune dépense réelle n'est créée, aucun compte n'est affecté.
      </div>

      <label style={labelStyle()}>Depuis la catégorie</label>
      <select style={fieldStyle()} value={fromCategoryId} onChange={(e) => setFromCategoryId(e.target.value)}>
        {topCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
      </select>

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Vers la catégorie</label>
      <select style={fieldStyle()} value={toCategoryId} onChange={(e) => setToCategoryId(e.target.value)}>
        {topCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
      </select>
      {fromCategoryId === toCategoryId && (
        <div style={{ fontSize: 11, color: COLORS.coral, marginTop: 6 }}>Choisissez deux catégories différentes.</div>
      )}

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Montant</label>
      <input style={fieldStyle()} type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Note (optionnel)</label>
      <input style={fieldStyle()} type="text" placeholder="Ex : Ajustement fin de mois" value={note} onChange={(e) => setNote(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Date</label>
      <input style={fieldStyle()} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

      <button
        disabled={!canSave}
        onClick={() => onSave({ amount, fromCategoryId, toCategoryId, note, date })}
        style={{
          width: "100%", marginTop: 16, background: canSave ? COLORS.gold : COLORS.surface2, border: "none",
          color: canSave ? COLORS.bg : COLORS.textDim, borderRadius: 12, padding: "13px 0", fontSize: 14, fontWeight: 700,
        }}
      >
        Transférer
      </button>
    </ModalShell>
  );
}

function TransfersHistoryModal({ accountTransfers, categoryTransfers, categories, onClose, onDeleteAccountTransfer, onDeleteCategoryTransfer }) {
  const [sub, setSub] = useState("accounts"); // "accounts" | "categories"
  return (
    <ModalShell title="Historique des transferts" onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["accounts", "Entre comptes"], ["categories", "Entre catégories"]].map(([val, lab]) => (
          <button key={val} onClick={() => setSub(val)} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, border: `1.5px solid ${sub === val ? COLORS.gold : COLORS.border}`,
            background: sub === val ? `${COLORS.gold}22` : "transparent", color: sub === val ? COLORS.gold : COLORS.textDim, fontWeight: 600, fontSize: 12,
          }}>{lab}</button>
        ))}
      </div>

      {sub === "accounts" ? (
        accountTransfers.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} text="Aucun transfert entre comptes pour l'instant." />
        ) : accountTransfers.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `${COLORS.sky}26`, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.sky, flexShrink: 0 }}>
              <ArrowLeftRight size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.fromAccountName} → {t.toAccountName}
              </div>
              <div style={{ fontSize: 10.5, color: COLORS.textDim }}>{new Date(t.date).toLocaleDateString("fr-FR")}{t.label ? ` · ${t.label}` : ""}</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(t.amount)}</div>
            <button onClick={() => onDeleteAccountTransfer(t.txId)} style={{ background: "none", border: "none", color: COLORS.textDim, padding: 4 }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))
      ) : (
        categoryTransfers.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} text="Aucun transfert entre catégories pour l'instant." />
        ) : categoryTransfers.map((t) => {
          const fromMeta = catMeta(categories, t.fromCategoryId);
          const toMeta = catMeta(categories, t.toCategoryId);
          return (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${COLORS.purple}26`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                {fromMeta.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fromMeta.name} → {toMeta.name}
                </div>
                <div style={{ fontSize: 10.5, color: COLORS.textDim }}>{new Date(t.date).toLocaleDateString("fr-FR")}{t.note ? ` · ${t.note}` : ""}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(t.amount)}</div>
              <button onClick={() => onDeleteCategoryTransfer(t.id)} style={{ background: "none", border: "none", color: COLORS.textDim, padding: 4 }}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })
      )}
    </ModalShell>
  );
}

function AddTransactionModal({ accounts, formAccounts, categories, onClose, onSave, onTransfer }) {
  const srcAccounts = formAccounts && formAccounts.length > 0 ? formAccounts : accounts;
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  // Category list is independent of the expense/income/transfer toggle above:
  // any category can be picked for any transaction type. Only the transfer
  // (structural) category is excluded, since transfers use their own flow.
  const expenseCats = categories.filter((c) => !c.parentId && !c.isTransferCategory && c.nature !== "income");
  const incomeCats = categories.filter((c) => !c.parentId && !c.isTransferCategory && c.nature === "income");
  const topOptions = [...expenseCats, ...incomeCats];
  const [topCatId, setTopCatId] = useState(topOptions[0]?.id || "");
  const [subCatId, setSubCatId] = useState("");
  const [accountId, setAccountId] = useState(srcAccounts[0]?.id || "");
  const [fromId, setFromId] = useState(srcAccounts[0]?.id || "");
  const [toId, setToId] = useState(accounts.find((a) => a.id !== srcAccounts[0]?.id)?.id || accounts[0]?.id || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const subOptions = categories.filter((c) => c.parentId === topCatId);
  const isTransfer = type === "transfer";
  const canSave = isTransfer
    ? amount && Number(amount) > 0 && fromId && toId && fromId !== toId
    : amount && Number(amount) > 0 && accountId && topCatId;

  const handleSave = () => {
    if (isTransfer) {
      onTransfer({ amount: Number(amount), fromId, toId, date, label });
    } else {
      onSave({ type, amount: Number(amount), label, categoryId: subCatId || topCatId, accountId, date });
    }
  };

  return (
    <ModalShell title={isTransfer ? "Nouveau transfert" : "Nouvelle transaction"} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["expense", "Dépense", COLORS.coral], ["income", "Revenu", COLORS.mint], ["transfer", "Transfert", COLORS.sky]].map(([val, lab, col]) => (
          <button key={val} onClick={() => setType(val)} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, border: `1.5px solid ${type === val ? col : COLORS.border}`,
            background: type === val ? `${col}22` : "transparent", color: type === val ? col : COLORS.textDim, fontWeight: 600, fontSize: 12.5,
          }}>{lab}</button>
        ))}
      </div>

      <label style={labelStyle()}>Montant</label>
      <input style={fieldStyle()} type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Description {isTransfer ? "(optionnel)" : ""}</label>
      <input style={fieldStyle()} type="text" placeholder={isTransfer ? "Ex : Épargne du mois" : "Ex : Courses Marjane"} value={label} onChange={(e) => setLabel(e.target.value)} />

      {isTransfer ? (
        <>
          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Depuis le compte</label>
          <select style={fieldStyle()} value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {srcAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Vers le compte</label>
          <select style={fieldStyle()} value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {fromId === toId && (
            <div style={{ fontSize: 11, color: COLORS.coral, marginTop: 6 }}>Choisissez deux comptes différents.</div>
          )}
        </>
      ) : (
        <>
          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Catégorie</label>
          <select style={fieldStyle()} value={topCatId} onChange={(e) => { setTopCatId(e.target.value); setSubCatId(""); }}>
            {expenseCats.length > 0 && (
              <optgroup label="Dépenses">
                {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </optgroup>
            )}
            {incomeCats.length > 0 && (
              <optgroup label="Revenus">
                {incomeCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </optgroup>
            )}
          </select>

          {subOptions.length > 0 && (
            <>
              <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Sous-catégorie (optionnel)</label>
              <select style={fieldStyle()} value={subCatId} onChange={(e) => setSubCatId(e.target.value)}>
                <option value="">Aucune</option>
                {subOptions.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </>
          )}

          <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Compte</label>
          <select style={fieldStyle()} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {srcAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </>
      )}

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Date</label>
      <input style={fieldStyle()} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

      <button
        disabled={!canSave}
        onClick={handleSave}
        style={{
          width: "100%", marginTop: 18, padding: 13, borderRadius: 12, border: "none",
          background: canSave ? COLORS.gold : COLORS.surface2, color: canSave ? COLORS.bg : COLORS.textDim,
          fontWeight: 700, fontSize: 14,
        }}
      >
        {isTransfer ? "Transférer" : "Enregistrer"}
      </button>
    </ModalShell>
  );
}

function AddAccountModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Banque");
  const [balance, setBalance] = useState("");
  const [color, setColor] = useState(getAccountColor("Banque"));

  return (
    <ModalShell title="Nouveau compte" onClose={onClose}>
      <label style={labelStyle()}>Nom du compte</label>
      <input style={fieldStyle()} type="text" placeholder="Ex : Livret d'épargne" value={name} onChange={(e) => setName(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Type</label>
      <select style={fieldStyle()} value={type} onChange={(e) => { setType(e.target.value); setColor(getAccountColor(e.target.value)); }}>
        {Object.keys(ACCOUNT_ICONS).map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Solde initial</label>
      <input style={fieldStyle()} type="number" placeholder="0.00" value={balance} onChange={(e) => setBalance(e.target.value)} />

      <label style={{ ...labelStyle(), display: "block", marginTop: 12 }}>Couleur du cadran</label>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {PALETTE.map((c) => (
          <button key={c} onClick={() => setColor(c)} style={{
            width: 26, height: 26, borderRadius: "50%", background: c,
            border: color === c ? `2px solid ${COLORS.text}` : "2px solid transparent",
            boxShadow: color === c ? `0 0 0 2px ${COLORS.bg}` : "none",
          }} />
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex" }}>
        <AccountDial
          a={{ name: name || "Nouveau compte", type, balance: Number(balance) || 0, color }}
          isSelected={false} onPressStart={() => {}} onPressEnd={() => {}} onPressCancel={() => {}}
        />
      </div>

      <button
        disabled={!name}
        onClick={() => onSave({ name, type, balance, color })}
        style={{
          width: "100%", marginTop: 18, padding: 13, borderRadius: 12, border: "none",
          background: name ? COLORS.gold : COLORS.surface2, color: name ? COLORS.bg : COLORS.textDim,
          fontWeight: 700, fontSize: 14,
        }}
      >
        Ajouter le compte
      </button>
    </ModalShell>
  );
}
