import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Smartphone,
  Wifi,
  Receipt,
  Package,
  TrendingUp,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Wallet,
  CalendarClock,
  LayoutDashboard,
  X,
  Users,
  CreditCard,
  ShoppingCart,
  Boxes,
  RefreshCw,
  ClipboardList,
  Calculator,
  Cloud,
  CloudOff,
  Lock,
  LogOut,
  Trash2,
  Tag,
  Share2,
  Copy,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { supabase, supabaseConfigured, loadRemoteData, saveRemoteData } from "./supabaseClient";

const STORAGE_KEY = "movistar-negocio-data";

const PAYMENT_METHODS = ["Efectivo", "Pago Móvil", "Punto de Venta", "Zelle", "Binance", "$ Físico", "Cashea"];
const PAYMENT_METHOD_ALL = [...PAYMENT_METHODS, "Pagos Múltiples"];
const BS_METHODS = ["Efectivo", "Pago Móvil", "Punto de Venta"];
const currencySymbolFor = (metodo) => (BS_METHODS.includes(metodo) ? "Bs." : "$");
const CATEGORIES = ["SIM Card", "eSIM", "Accesorio", "Teléfono", "Repuestos"];
const CREDIT_PLATFORMS = ["Crédito propio", "Cashea", "Chollo"];
const PLATFORM_COMMISSION_DEFAULT = { Cashea: 4, Chollo: 5 };
// Cashea permite financiar cualquier producto (línea nueva, cambio de línea, accesorios, repuestos),
// no solo teléfonos. Cuando se usa así, cobra una comisión fija del 7% sobre lo financiado.
const CASHEA_GENERAL_COMISION_PCT = 7;

const METHOD_TO_ACCOUNT = {
  "Pago Móvil": "Cuenta Bancaria",
  "Punto de Venta": "Punto de Venta",
  Zelle: "Zelle",
  Efectivo: "Efectivo",
  "$ Físico": "$ Efectivo",
  Binance: "Binance",
  Cashea: "Cashea",
};
const WALLET_ACCOUNTS = ["Cuenta Bancaria", "Punto de Venta", "Efectivo", "Zelle", "Binance", "$ Efectivo", "Cashea", "Chollo", "Opercoll"];
const ACCOUNT_CURRENCY = {
  "Cuenta Bancaria": "VES",
  "Punto de Venta": "VES",
  Efectivo: "VES",
  Zelle: "USD",
  Binance: "USD",
  "$ Efectivo": "USD",
  Cashea: "USD",
  Chollo: "USD",
  Opercoll: "VES",
};
// Opercoll es la plataforma que se usa para recargar las líneas nuevas. No es un método de pago
// que el cliente elija — es un saldo prepago que el negocio le transfiere directamente (con un 5%
// de bono sobre lo transferido), y que se consume automáticamente con cada recarga de Línea Nueva.
const OPERCOLL_BONO_PCT = 5;
const fmtAccountAmount = (n, currency) => {
  const val = (Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${val}` : `Bs. ${val}`;
};

// Public, keyless JSON feed that republishes the official BCV rate (bcv.today), so
// Tasa BCV can stay in sync with the Banco Central de Venezuela without manual entry.
const BCV_TODAY_API = "https://bcv.today/api/v1/rate.json";
async function fetchTasaBCV() {
  const res = await fetch(BCV_TODAY_API);
  if (!res.ok) throw new Error("BCV Today respondió con error");
  const json = await res.json();
  if (!json || !json.USD) throw new Error("Respuesta inesperada de BCV Today");
  return { tasa: Number(json.USD), fechaVigencia: json.effective_date || json.date || null };
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => new Date().toISOString().slice(0, 10);

// Días anteriores a hoy que tuvieron ventas pero no tienen cierre de caja registrado.
// Se usa para bloquear nuevas ventas hasta que el usuario cierre la caja de esos días.
const getFechasPendientesCierre = (data) => {
  const hoy = todayISO();
  const fechasConVentas = new Set(
    (data.sales || [])
      .filter((s) => s.tipo !== "Financiamiento Cashea" && s.fecha && s.fecha < hoy)
      .map((s) => s.fecha)
  );
  const fechasCerradas = new Set((data.cierresCaja || []).map((c) => c.fecha));
  return [...fechasConVentas].filter((f) => !fechasCerradas.has(f)).sort();
};

const addMonths = (isoDate, n) => {
  const d = new Date(isoDate + "T00:00:00");
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (isoA, isoB) => {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / 86400000);
};

const fmtDate = (iso) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const marginPct = (costo, precio) => {
  const c = Number(costo) || 0;
  const p = Number(precio) || 0;
  if (c <= 0) return p > 0 ? 100 : 0;
  return ((p - c) / c) * 100;
};

const marginTone = (pct) => (pct >= 50 ? "success" : pct >= 20 ? "primary" : pct >= 0 ? "warning" : "danger");

const convertBs = (bs, currency, tasa) => {
  const t = Number(tasa) || 1;
  return currency === "VES" ? Number(bs) || 0 : (Number(bs) || 0) / t;
};

const DEFAULT_PLANES = [
  { id: "plan-4gb", nombre: "4 GB", comisionBs: 4750.23 },
  { id: "plan-6gb", nombre: "6 GB", comisionBs: 5066.92 },
  { id: "plan-10gb", nombre: "10 GB", comisionBs: 8233.74 },
  { id: "plan-25gb", nombre: "25 GB", comisionBs: 12667.29 },
];

const INCENTIVO_BANDAS = [
  { banda: 1, min: 101, max: 105.99, pct: 10 },
  { banda: 2, min: 106, max: 111.99, pct: 13 },
  { banda: 3, min: 112, max: Infinity, pct: 15 },
];

function useCurrency(currency) {
  return (n) => {
    const val = Number(n) || 0;
    const formatted = val.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency === "USD" ? `$${formatted}` : `Bs. ${formatted}`;
  };
}

function paymentDefault() {
  return {
    medioPago: "Efectivo",
    montoCobrado: "",
    pagosMultiples: [
      { metodo: PAYMENT_METHODS[0], monto: "" },
      { metodo: PAYMENT_METHODS[1], monto: "" },
    ],
  };
}

function buildPagos(pago) {
  if (pago.medioPago === "Pagos Múltiples") {
    return pago.pagosMultiples
      .filter((p) => Number(p.monto) > 0)
      .map((p) => ({ metodo: p.metodo, monto: Number(p.monto) || 0 }));
  }
  return [{ metodo: pago.medioPago, monto: Number(pago.montoCobrado) || 0 }];
}

// Converts a payment amount into the app's native display currency, since a Bs. method
// and a $ method can be mixed in the same sale (e.g. Pagos Múltiples).
function toNativeCurrency(monto, metodo, nativeCurrency, tasa) {
  const t = Number(tasa) || 1;
  const esBs = BS_METHODS.includes(metodo);
  if (nativeCurrency === "USD") {
    return esBs ? (Number(monto) || 0) / t : Number(monto) || 0;
  }
  return esBs ? Number(monto) || 0 : (Number(monto) || 0) * t;
}

// Converts a declared price from whichever currency the person typed it in (USD or VES)
// into the app's native display currency, using the tasa interna.
function convertAmountCurrency(monto, fromCurrency, toCurrency, tasa) {
  const t = Number(tasa) || 1;
  const val = Number(monto) || 0;
  if (fromCurrency === toCurrency) return val;
  return fromCurrency === "USD" ? val * t : val / t;
}

// Converts a payment (in its own Bs./$ method-currency) directly to USD.
function pagoToUSD(monto, metodo, tasa) {
  const t = Number(tasa) || 1;
  return BS_METHODS.includes(metodo) ? (Number(monto) || 0) / t : Number(monto) || 0;
}

// Converts a native-currency amount (whatever the app's display currency is) to USD.
function nativeToUSD(amountNative, nativeCurrency, tasa) {
  const t = Number(tasa) || 1;
  return nativeCurrency === "USD" ? Number(amountNative) || 0 : (Number(amountNative) || 0) / t;
}

function pagosNativeTotal(pagos, nativeCurrency, tasa) {
  return pagos.reduce((s, p) => s + toNativeCurrency(p.monto, p.metodo, nativeCurrency, tasa), 0);
}

// Sums payment amounts grouped by their wallet account, and reports which accounts
// (if any) would go negative given their current wallet balance.
function excesosDeSaldo(pagos, walletBalances) {
  const porMetodo = {};
  pagos.forEach((p) => {
    if (Number(p.monto) > 0) porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + Number(p.monto);
  });
  const excesos = [];
  Object.entries(porMetodo).forEach(([metodo, monto]) => {
    const cuenta = METHOD_TO_ACCOUNT[metodo];
    if (!cuenta) return;
    const disponible = walletBalances[cuenta] || 0;
    if (monto > disponible + 0.01) {
      excesos.push({ metodo, cuenta, monto, disponible });
    }
  });
  return excesos;
}

// Distributes one generalized account-level abono (a pool of payments, possibly in several
// methods/currencies) across a supplier's pending invoices oldest-first (FIFO), splitting a
// payment method proportionally when it has to cover part of one invoice and part of the next.
function distribuirAbonoFIFO(facturasPendientesAsc, pagos, nativeCurrency, tasa) {
  const pool = pagos.map((p) => ({
    metodo: p.metodo,
    remainingOwn: Number(p.monto) || 0,
    remainingNative: toNativeCurrency(p.monto, p.metodo, nativeCurrency, tasa),
  }));
  const asignaciones = {};
  facturasPendientesAsc.forEach((f) => {
    let necesario = f.saldoPendiente;
    if (necesario <= 0.01) return;
    const lista = [];
    for (const entry of pool) {
      if (necesario <= 0.01) break;
      if (entry.remainingNative <= 0.01) continue;
      const useNative = Math.min(entry.remainingNative, necesario);
      const fraction = useNative / entry.remainingNative;
      const useOwn = entry.remainingOwn * fraction;
      lista.push({ metodo: entry.metodo, monto: useOwn, fecha: todayISO() });
      entry.remainingNative -= useNative;
      entry.remainingOwn -= useOwn;
      necesario -= useNative;
    }
    if (lista.length > 0) asignaciones[f.id] = lista;
  });
  return asignaciones;
}

// Splits one combined payment (possibly several methods/currencies) across several cart
// items that are being invoiced together, proportionally, so each item's own sale record
// still carries an accurate pagos breakdown for the wallet and per-item history.
function distribuirPagoEntreItems(items, pagos, nativeCurrency, tasa) {
  const pool = pagos.map((p) => ({
    metodo: p.metodo,
    remainingOwn: Number(p.monto) || 0,
    remainingNative: toNativeCurrency(p.monto, p.metodo, nativeCurrency, tasa),
  }));
  const resultado = {};
  items.forEach((it) => {
    let necesario = it.montoCliente;
    const lista = [];
    for (const entry of pool) {
      if (necesario <= 0.01) break;
      if (entry.remainingNative <= 0.01) continue;
      const useNative = Math.min(entry.remainingNative, necesario);
      const fraction = useNative / entry.remainingNative;
      const useOwn = entry.remainingOwn * fraction;
      lista.push({ metodo: entry.metodo, monto: useOwn });
      entry.remainingNative -= useNative;
      entry.remainingOwn -= useOwn;
      necesario -= useNative;
    }
    resultado[it.key] = lista;
  });
  return resultado;
}

// Formats a native-currency amount as both USD and Bs. equivalents, for change/vuelto display.
function formatBothCurrencies(amountNative, nativeCurrency, tasa) {
  const t = Number(tasa) || 1;
  const usd = nativeCurrency === "USD" ? amountNative : amountNative / t;
  const bs = nativeCurrency === "VES" ? amountNative : amountNative * t;
  const fmt = (n) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${fmt(usd)} · Bs. ${fmt(bs)}`;
}

// Given a sale amount in the app's native currency, returns what the Bs. charged (at tasaInterna)
// equals in USD when divided by the official tasaBCV — the "fiscal" value that would appear
// on a BCV-rate invoice, which differs from the real price due to the rate gap.
function bcvFiscalEquivalent(totalNative, nativeCurrency, tasaInterna, tasaBCV) {
  const montoBs = nativeCurrency === "USD" ? totalNative * (Number(tasaInterna) || 1) : totalNative;
  return montoBs / (Number(tasaBCV) || 1);
}

// Converts a native-currency amount directly to Bs. using the official tasa BCV (not the
// internal rate) — used to show pending-collection amounts in official BCV bolívares.
function convertNativeToBs(amountNative, nativeCurrency, tasa) {
  const t = Number(tasa) || 1;
  return nativeCurrency === "USD" ? amountNative * t : amountNative / t;
}

function upsertClient(clients, { nombre, cedula, telefono }) {
  if (!nombre || !nombre.trim()) return clients;
  const norm = (cedula || "").trim().toLowerCase();
  const existing = norm ? clients.find((c) => (c.cedula || "").trim().toLowerCase() === norm) : null;
  if (existing) {
    if (telefono && !existing.telefono) {
      return clients.map((c) => (c.id === existing.id ? { ...c, telefono } : c));
    }
    return clients;
  }
  return [{ id: uid(), nombre, cedula, telefono, fechaRegistro: todayISO() }, ...clients];
}

function decrementStock(products, productId, cantidad = 1) {
  return products.map((p) => (p.id === productId ? { ...p, stock: Math.max(0, Number(p.stock) - cantidad) } : p));
}

// ---------- shared UI bits ----------
function SignalBars({ score }) {
  const level = score >= 0.75 ? 4 : score >= 0.5 ? 3 : score >= 0.25 ? 2 : score > 0 ? 1 : 0;
  const color =
    level >= 4 ? "var(--color-success)" : level === 3 ? "var(--color-primary)" : level === 2 ? "var(--color-warning)" : "var(--color-danger)";
  return (
    <span className="signal-bars" title="Salud de margen">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="signal-bar" style={{ height: `${i * 4 + 4}px`, background: i <= level ? color : "var(--color-border)" }} />
      ))}
    </span>
  );
}

function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Card({ icon: Icon, label, value, sub, tone = "primary", onClick }) {
  return (
    <div className="stat-card" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div className={`stat-icon tone-${tone}`}>
        <Icon size={18} />
      </div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function MonedaToggle({ value, onChange }) {
  return (
    <div className="currency-toggle" style={{ display: "inline-flex" }}>
      <button className={value === "USD" ? "active" : ""} onClick={() => onChange("USD")} type="button">
        $
      </button>
      <button className={value === "VES" ? "active" : ""} onClick={() => onChange("VES")} type="button">
        Bs.
      </button>
    </div>
  );
}

// Select con buscador para elegir un producto de una lista larga escribiendo su nombre, en vez de
// tener que desplazarse por un <select> nativo viéndolos uno a uno (útil sobre todo con Repuestos,
// donde puede haber decenas de baterías).
function BuscadorProducto({ products, value, onChange, placeholder, renderLabel, emptyLabel }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? products.filter((p) => (p.nombre || "").toLowerCase().includes(q)) : products;

  return (
    <div style={{ position: "relative" }}>
      <input
        value={open ? query : selected ? renderLabel(selected) : ""}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value) onChange("");
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "white",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 240,
            overflowY: "auto",
            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--color-text-muted)" }}>{emptyLabel || "Sin resultados"}</div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p.id);
                  setQuery("");
                  setOpen(false);
                }}
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12.5, borderBottom: "1px solid var(--color-border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
              >
                {renderLabel(p)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BuscadorCliente({ clients, value, onChange, onSelect }) {
  const [open, setOpen] = useState(false);
  const q = (value || "").trim().toLowerCase();
  const matches = q.length >= 2 ? clients.filter((c) => (c.nombre || "").toLowerCase().includes(q)).slice(0, 8) : [];

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Nombre completo"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "white",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 240,
            overflowY: "auto",
            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          }}
        >
          {matches.map((c) => (
            <div
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(c);
                setOpen(false);
              }}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12.5, borderBottom: "1px solid var(--color-border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <div style={{ fontWeight: 700 }}>{c.nombre}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                {c.cedula || "Sin cédula"}
                {c.telefono ? ` · ${c.telefono}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TasaBadge({ label, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));

  if (!editing) {
    return (
      <button
        className="tasa-badge"
        onClick={() => {
          setInput(String(value));
          setEditing(true);
        }}
      >
        <RefreshCw size={12} />
        {label}: <strong>{Number(value).toLocaleString("es-VE")}</strong>
      </button>
    );
  }
  return (
    <div className="tasa-badge tasa-badge-editing">
      <span style={{ fontWeight: 700 }}>{label}:</span>
      <input
        type="number"
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onSave(Number(input) || value);
            setEditing(false);
          }
        }}
        style={{ width: 80, padding: "3px 6px", borderRadius: 5, border: "1px solid var(--color-border)", fontSize: 12 }}
      />
      <button
        className="icon-btn"
        onClick={() => {
          onSave(Number(input) || value);
          setEditing(false);
        }}
      >
        <Check size={13} />
      </button>
    </div>
  );
}

function SyncStatus({ dataSync }) {
  const map = {
    "local-only": { icon: CloudOff, text: "Guardado solo en este navegador", color: "var(--color-text-muted)" },
    loading: { icon: Cloud, text: "Cargando desde la nube…", color: "var(--color-text-muted)" },
    saving: { icon: Cloud, text: "Guardando en la nube…", color: "var(--color-warning)" },
    ok: { icon: Cloud, text: "Sincronizado con la nube", color: "var(--color-success)" },
    error: { icon: CloudOff, text: dataSync.error || "Error de sincronización", color: "var(--color-danger)" },
    conflict: { icon: AlertTriangle, text: "Hay cambios más nuevos en la nube — recarga antes de seguir", color: "var(--color-danger)" },
  };
  const s = map[dataSync.status] || map["local-only"];
  const Icon = s.icon;
  if (dataSync.status === "conflict") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: s.color }} title={dataSync.error}>
        <Icon size={13} />
        {s.text}
        <button
          className="btn btn-primary btn-sm"
          style={{ padding: "3px 10px" }}
          onClick={() => window.location.reload()}
        >
          Recargar
        </button>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: s.color }} title={s.text}>
      <Icon size={13} className={dataSync.status === "saving" || dataSync.status === "loading" ? "spin" : ""} />
      {s.text}
    </span>
  );
}

function PaymentSection({ value, onChange, label = "Monto cobrado" }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const updateRow = (idx, field, v) => {
    const rows = [...value.pagosMultiples];
    rows[idx] = { ...rows[idx], [field]: v };
    set({ pagosMultiples: rows });
  };
  const addRow = () => set({ pagosMultiples: [...value.pagosMultiples, { metodo: PAYMENT_METHODS[0], monto: "" }] });
  const removeRow = (idx) => set({ pagosMultiples: value.pagosMultiples.filter((_, i) => i !== idx) });

  return (
    <div>
      <div className="form-grid" style={{ marginTop: 6 }}>
        <div className="field">
          <label>Método de pago</label>
          <select value={value.medioPago} onChange={(e) => set({ medioPago: e.target.value })}>
            {PAYMENT_METHOD_ALL.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {value.medioPago !== "Pagos Múltiples" && (
          <div className="field">
            <label>
              {label} <span style={{ color: "var(--color-primary)" }}>({currencySymbolFor(value.medioPago)})</span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "var(--color-text-muted)",
                  minWidth: 28,
                }}
              >
                {currencySymbolFor(value.medioPago)}
              </span>
              <input type="number" value={value.montoCobrado} onChange={(e) => set({ montoCobrado: e.target.value })} placeholder="0.00" />
            </div>
          </div>
        )}
      </div>
      {value.medioPago === "Pagos Múltiples" && (
        <div style={{ marginBottom: 10 }}>
          {value.pagosMultiples.map((p, idx) => (
            <div className="gasto-row" key={idx}>
              <select
                value={p.metodo}
                onChange={(e) => updateRow(idx, "metodo", e.target.value)}
                style={{ padding: "7px 9px", borderRadius: 7, border: "1px solid var(--color-border)", fontSize: 12.5 }}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--color-text-muted)" }}>{currencySymbolFor(p.metodo)}</span>
                <input
                  type="number"
                  placeholder="Monto"
                  value={p.monto}
                  onChange={(e) => updateRow(idx, "monto", e.target.value)}
                  style={{ padding: "7px 9px", borderRadius: 7, border: "1px solid var(--color-border)", fontSize: 12.5, width: "100%" }}
                />
              </div>
              <button className="icon-btn" onClick={() => removeRow(idx)}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={addRow}>
            <Plus size={13} /> Agregar método
          </button>
          <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 6 }}>
            Total: {value.pagosMultiples.reduce((s, p) => s + (Number(p.monto) || 0), 0).toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}

function AbonoMultiMetodo({ rows, onChange }) {
  const updateRow = (idx, field, value) => {
    const copy = [...rows];
    copy[idx] = { ...copy[idx], [field]: value };
    onChange(copy);
  };
  const addRow = () => onChange([...rows, { metodo: PAYMENT_METHODS[0], monto: "" }]);
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  return (
    <div style={{ marginBottom: 10 }}>
      {rows.map((r, idx) => (
        <div className="gasto-row" key={idx}>
          <select
            value={r.metodo}
            onChange={(e) => updateRow(idx, "metodo", e.target.value)}
            style={{ padding: "7px 9px", borderRadius: 7, border: "1px solid var(--color-border)", fontSize: 12.5 }}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--color-text-muted)" }}>{currencySymbolFor(r.metodo)}</span>
            <input
              type="number"
              placeholder="Monto"
              value={r.monto}
              onChange={(e) => updateRow(idx, "monto", e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 7, border: "1px solid var(--color-border)", fontSize: 12.5, width: "100%" }}
            />
          </div>
          {rows.length > 1 && (
            <button className="icon-btn" onClick={() => removeRow(idx)}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={addRow}>
        <Plus size={13} /> Agregar método
      </button>
    </div>
  );
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message === "Invalid login credentials" ? "Correo o clave incorrectos." : authError.message);
      return;
    }
    onLoggedIn(data.session);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F3F6FA",
        fontFamily: "'Inter', system-ui, sans-serif",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "white",
          borderRadius: 14,
          padding: "32px 30px",
          width: 340,
          maxWidth: "100%",
          boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
          border: "1px solid #E2E8F0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "#4FB6E8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#042A57",
              fontWeight: 800,
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            M
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#042A57" }}>Punto Movistar</div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Control de negocio</div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 18,
            marginBottom: 14,
            color: "#64748B",
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          <Lock size={14} /> Inicia sesión para continuar
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>Correo</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            style={{ width: "100%", padding: "9px 10px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>Clave</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ width: "100%", padding: "9px 10px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        {error && (
          <div
            style={{
              background: "#FBE9E9",
              color: "#DC2626",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 7,
              padding: "8px 10px",
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            justifyContent: "center",
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: loading ? "#E2E8F0" : "#0A5FBF",
            color: loading ? "#64748B" : "white",
            fontWeight: 700,
            fontSize: 13,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          {loading ? "Ingresando…" : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState({
    currency: "USD",
    tasaInterna: 633.3644,
    tasaBCV: 633.3644,
    clients: [],
    products: [],
    planes: DEFAULT_PLANES,
    sales: [],
    credits: [],
    compras: [],
    ordenesCompra: [],
    cierresCaja: [],
    gastosGenerales: [],
    saldosIniciales: {},
    transferenciasOpercoll: [],
    ultimoNumeroFactura: 0,
    cholloPct: 17,
  });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [bcvSync, setBcvSync] = useState({ status: "idle", fechaVigencia: null, lastCheck: null, error: null });
  const [dataSync, setDataSync] = useState({ status: supabaseConfigured ? "loading" : "local-only", lastSaved: null, error: null });
  const remoteUpdatedAtRef = useRef(null);
  const money = useCurrency(data.currency);

  // ---------- auth gate: require a logged-in Supabase user before showing/loading any data ----------
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(!supabaseConfigured);
  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const syncTasaBCV = async () => {
    setBcvSync((s) => ({ ...s, status: "loading" }));
    try {
      const { tasa, fechaVigencia } = await fetchTasaBCV();
      setData((d) => ({ ...d, tasaBCV: tasa }));
      setBcvSync({ status: "ok", fechaVigencia, lastCheck: new Date().toISOString(), error: null });
    } catch (e) {
      setBcvSync((s) => ({ ...s, status: "error", lastCheck: new Date().toISOString(), error: "No se pudo conectar con BCV Today" }));
    }
  };

  useEffect(() => {
    syncTasaBCV();
    const interval = setInterval(syncTasaBCV, 30 * 60 * 1000); // revisa cada 30 minutos mientras esté abierto
    return () => clearInterval(interval);
  }, []);

  // ---------- load on mount: Supabase (cloud, source of truth) first, localStorage as fallback ----------
  useEffect(() => {
    (async () => {
      let parsed = null;
      if (supabaseConfigured) {
        try {
          const remote = await loadRemoteData();
          if (remote) {
            parsed = remote.data;
            remoteUpdatedAtRef.current = remote.updatedAt;
          }
        } catch (e) {
          console.error("No se pudo cargar desde Supabase, se usará la copia local si existe", e);
        }
      }
      if (!parsed) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) parsed = JSON.parse(raw);
        } catch (e) {
          console.error("Error leyendo copia local", e);
        }
      }
      if (parsed) {
        const planes = parsed.planes && parsed.planes.length > 0 ? parsed.planes : DEFAULT_PLANES;
        const tasaInterna = parsed.tasaInterna || parsed.tasaCambio || 633.3644;
        const tasaBCV = parsed.tasaBCV || parsed.tasaCambio || 633.3644;
        const compras = parsed.compras || [];
        const ordenesCompra = parsed.ordenesCompra || [];
        const cierresCaja = parsed.cierresCaja || [];
        const gastosGenerales = parsed.gastosGenerales || [];
        const saldosIniciales = parsed.saldosIniciales || {};
        const transferenciasOpercoll = parsed.transferenciasOpercoll || [];
        const ultimoNumeroFactura = parsed.ultimoNumeroFactura || 0;
        const cholloPct = parsed.cholloPct != null ? parsed.cholloPct : 17;
        setData((d) => ({
          ...d,
          ...parsed,
          planes,
          tasaInterna,
          tasaBCV,
          compras,
          ordenesCompra,
          cierresCaja,
          gastosGenerales,
          saldosIniciales,
          transferenciasOpercoll,
          ultimoNumeroFactura,
          cholloPct,
        }));
      } else {
        setData((d) => ({ ...d, planes: DEFAULT_PLANES }));
      }
      setDataSync((s) => ({ ...s, status: supabaseConfigured ? "ok" : "local-only" }));
      setLoaded(true);
    })();
  }, []);

  // ---------- save on every change: localStorage immediately (instant, offline-safe), Supabase debounced (cloud sync) ----------
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Error guardando copia local", e);
    }
    if (!supabaseConfigured) return;
    setDataSync((s) => ({ ...s, status: "saving" }));
    const timeout = setTimeout(async () => {
      try {
        const result = await saveRemoteData(data, remoteUpdatedAtRef.current);
        if (result.conflict) {
          // Someone else (another tab, device, or browser session) saved to the cloud since
          // we last loaded/saved. Refuse to overwrite their changes silently — instead, tell
          // the user to reload so they don't lose data without knowing it.
          setDataSync({
            status: "conflict",
            lastSaved: null,
            error: "Estos datos se actualizaron desde otra pestaña o dispositivo. Recarga la página para ver lo más reciente antes de seguir editando aquí.",
          });
          return;
        }
        remoteUpdatedAtRef.current = result.updatedAt;
        setDataSync({ status: "ok", lastSaved: new Date().toISOString(), error: null });
      } catch (e) {
        console.error("Error guardando en Supabase", e);
        setDataSync({ status: "error", lastSaved: null, error: "No se pudo sincronizar con la nube — se guardó localmente" });
      }
    }, 800);
    return () => clearTimeout(timeout);
  }, [data, loaded]);

  // ---------- derived metrics ----------
  const metrics = useMemo(() => {
    const lineas = data.sales.filter((s) => s.tipo === "Línea Nueva");
    const accesorios = data.sales.filter((s) => s.tipo === "Accesorios");
    const telContado = data.sales.filter((s) => s.tipo === "Teléfono Contado");
    const telCredito = data.sales.filter((s) => s.tipo === "Teléfono Crédito");
    const cambios = data.sales.filter((s) => s.tipo === "Cambio/Recuperación de Línea");

    const totalComisiones = lineas.reduce((s, l) => s + (Number(l.comision) || 0), 0);
    const totalGastosLineas = lineas.reduce((s, l) => s + (Number(l.costoSim) || 0), 0);
    const gananciaLineas = totalComisiones - totalGastosLineas;

    const ingresosAccesorios = accesorios.reduce((s, a) => s + a.items.reduce((is, it) => is + it.cantidad * it.precioUnit, 0), 0);
    const gananciaAccesorios = accesorios.reduce((s, a) => s + a.ganancia, 0);

    const gananciaTelContado = telContado.reduce((s, t) => s + t.ganancia, 0);
    const gananciaTelCreditoPotencial = telCredito.reduce((s, t) => s + t.ganancia, 0);
    const gananciaCambios = cambios.reduce((s, c) => s + c.ganancia, 0);

    const montoPorCobrar = data.credits.reduce((s, c) => s + c.cuotas.filter((q) => !q.pagado).reduce((qs, q) => qs + q.monto, 0), 0);

    const stockBajo = data.products.filter((p) => Number(p.stock) <= 5);

    const gananciaTotal = gananciaLineas + gananciaAccesorios + gananciaTelContado + gananciaCambios;

    return {
      totalComisiones,
      totalGastosLineas,
      gananciaLineas,
      ingresosAccesorios,
      gananciaAccesorios,
      gananciaTelContado,
      gananciaTelCreditoPotencial,
      gananciaCambios,
      montoPorCobrar,
      stockBajo,
      gananciaTotal,
      countLineas: lineas.length,
      countAccesorios: accesorios.length,
      countTelContado: telContado.length,
      countTelCredito: telCredito.length,
      countCambios: cambios.length,
    };
  }, [data]);

  const chartData = useMemo(() => {
    const byMonth = {};
    data.sales
      .filter((s) => s.tipo !== "Financiamiento Cashea")
      .forEach((s) => {
      const key = s.fecha ? s.fecha.slice(0, 7) : "s/f";
      if (!byMonth[key]) byMonth[key] = { mes: key, ventas: 0, ganancia: 0 };
      byMonth[key].ventas += 1;
      byMonth[key].ganancia += Number(s.ganancia) || 0;
    });
    return Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [data.sales]);

  const gastosPorConcepto = useMemo(() => {
    const map = {};
    (data.gastosGenerales || []).forEach((g) => {
      const key = g.concepto || "Otro";
      const montoNativo = toNativeCurrency(g.monto, g.metodo, data.currency, data.tasaInterna);
      map[key] = (map[key] || 0) + montoNativo;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [data.gastosGenerales, data.currency, data.tasaInterna]);

  const ingresosPorMetodoPago = useMemo(() => {
    const map = {};
    data.sales.forEach((s) => {
      (s.pagos || []).forEach((p) => {
        const key = p.metodo || "Otro";
        map[key] = (map[key] || 0) + (Number(p.monto) || 0);
      });
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [data.sales]);

  const walletBalances = useMemo(() => {
    const balances = {};
    WALLET_ACCOUNTS.forEach((a) => (balances[a] = Number((data.saldosIniciales || {})[a]) || 0));

    // Money in: every sale's collected payments (Línea Nueva, Accesorios, Teléfono Contado,
    // Cambio/Recuperación, and the inicial of Teléfono Crédito).
    data.sales.forEach((s) => {
      (s.pagos || []).forEach((p) => {
        const account = METHOD_TO_ACCOUNT[p.metodo];
        if (account) balances[account] += Number(p.monto) || 0;
      });
    });

    // Money in: Cashea/Chollo pay out the financed amount (net of their commission) about a
    // week after the sale, once you mark it as received — not at the moment you sell it. This
    // applies both to phones financed on credit and to any other product financed through Cashea
    // directly from the cart (tipo "Financiamiento Cashea").
    data.sales.forEach((s) => {
      if (
        (s.tipo === "Teléfono Crédito" || s.tipo === "Financiamiento Cashea") &&
        (s.plataforma === "Cashea" || s.plataforma === "Chollo") &&
        s.liquidado
      ) {
        balances[s.plataforma] += Number(s.montoFinanciadoNeto) || 0;
      }
    });

    // Money out: general business expenses (rent, transport, promoter commissions, etc.).
    (data.gastosGenerales || []).forEach((g) => {
      const account = METHOD_TO_ACCOUNT[g.metodo];
      if (account) balances[account] -= Number(g.monto) || 0;
    });

    // Opercoll: cada transferencia sale de la cuenta de origen y entra a Opercoll con un 5% de
    // bono (si transfieres 30.000, Opercoll te acredita 31.500 de saldo para recargar).
    (data.transferenciasOpercoll || []).forEach((t) => {
      const origen = METHOD_TO_ACCOUNT[t.metodo];
      if (origen) balances[origen] -= Number(t.monto) || 0;
      balances["Opercoll"] += Number(t.montoAcreditado) || 0;
    });

    // Opercoll se consume automáticamente: cada venta de Línea Nueva descuenta de su saldo
    // exactamente el mismo monto en Bs. que se cobró por la recarga — ni un centavo distinto.
    // `montoRecargaBs` guarda ese monto tal cual se cobró, sin volver a convertirlo con la tasa
    // BCV de hoy (que puede haber cambiado desde la venta y generaría un monto ligeramente
    // distinto al que realmente se cobró). Las ventas viejas que no tengan ese campo (de antes de
    // este arreglo) usan el cálculo anterior como respaldo.
    data.sales.forEach((s) => {
      if (s.tipo === "Línea Nueva") {
        balances["Opercoll"] -= s.montoRecargaBs != null ? Number(s.montoRecargaBs) : convertNativeToBs(s.montoRecarga, data.currency, data.tasaBCV);
      }
    });

    // Money out: inventory purchases (new stock or restocking).
    (data.compras || []).forEach((c) => {
      const account = METHOD_TO_ACCOUNT[c.metodo];
      if (account) balances[account] -= Number(c.costoTotal) || 0;
    });

    // Money out: purchase orders — every payment made against a purchase order (at
    // creation or later, when settling a pending balance) is stored in its `pagos` array.
    (data.ordenesCompra || []).forEach((o) => {
      (o.pagos || []).forEach((p) => {
        const account = METHOD_TO_ACCOUNT[p.metodo];
        if (account) balances[account] -= Number(p.monto) || 0;
      });
    });

    return balances;
  }, [
    data.sales,
    data.credits,
    data.compras,
    data.ordenesCompra,
    data.gastosGenerales,
    data.saldosIniciales,
    data.transferenciasOpercoll,
    data.currency,
    data.tasaBCV,
  ]);

  const PIE_COLORS = ["#0A5FBF", "#4FB6E8", "#063E80", "#F59E0B", "#16A34A", "#DC2626", "#042A57"];

  if (supabaseConfigured && !authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", fontFamily: "'Inter', system-ui, sans-serif" }}>
        Cargando…
      </div>
    );
  }
  if (supabaseConfigured && !session) {
    return <LoginScreen onLoggedIn={setSession} />;
  }

  return (
    <div
      className="app-root"
      style={{
        "--color-primary": "#0A5FBF",
        "--color-primary-dark": "#063E80",
        "--color-deep": "#042A57",
        "--color-accent": "#4FB6E8",
        "--color-bg": "#F3F6FA",
        "--color-surface": "#FFFFFF",
        "--color-success": "#16A34A",
        "--color-warning": "#F59E0B",
        "--color-danger": "#DC2626",
        "--color-text": "#152238",
        "--color-text-muted": "#64748B",
        "--color-border": "#E2E8F0",
      }}
    >
      <style>{`
        .app-root { font-family: 'Inter', system-ui, sans-serif; background: var(--color-bg); color: var(--color-text); min-height: 640px; display: flex; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .app-root * { box-sizing: border-box; }
        .app-root h1, .app-root h2, .app-root h3 { font-family: 'Manrope', 'Inter', system-ui, sans-serif; margin: 0; }
        .sidebar { width: 216px; flex-shrink: 0; background: linear-gradient(180deg, var(--color-deep) 0%, var(--color-primary-dark) 100%); color: white; padding: 20px 12px; display: flex; flex-direction: column; gap: 4px; }
        .brand { display: flex; align-items: center; gap: 8px; padding: 6px 10px 22px 10px; }
        .brand-mark { width: 30px; height: 30px; border-radius: 8px; background: var(--color-accent); display: flex; align-items: center; justify-content: center; color: var(--color-deep); font-weight: 800; font-family: 'Manrope', sans-serif; }
        .brand-text { font-weight: 700; font-size: 14px; line-height: 1.15; }
        .brand-sub { font-size: 10.5px; opacity: 0.65; font-weight: 500; }
        .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; font-size: 13.5px; font-weight: 600; color: rgba(255,255,255,0.72); cursor: pointer; transition: background 0.15s, color 0.15s; border: none; background: transparent; text-align: left; width: 100%; }
        .nav-item:hover { background: rgba(255,255,255,0.08); color: white; }
        .nav-item.active { background: var(--color-accent); color: var(--color-deep); }
        .main { flex: 1; min-width: 0; padding: 22px 26px 30px 26px; overflow-y: auto; max-height: 720px; }
        .main-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
        .main-title { font-size: 19px; font-weight: 800; color: var(--color-deep); }
        .currency-toggle { display: flex; border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
        .currency-toggle button { border: none; background: var(--color-surface); padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer; color: var(--color-text-muted); }
        .currency-toggle button.active { background: var(--color-primary); color: white; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .stat-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 14px; display: flex; gap: 10px; align-items: flex-start; }
        .stat-icon { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .tone-primary { background: #E7F0FC; color: var(--color-primary); }
        .tone-success { background: #E7F7EE; color: var(--color-success); }
        .tone-warning { background: #FDF3E3; color: var(--color-warning); }
        .tone-danger { background: #FBE9E9; color: var(--color-danger); }
        .stat-label { font-size: 11.5px; color: var(--color-text-muted); font-weight: 600; }
        .stat-value { font-size: 18px; font-weight: 800; color: var(--color-text); margin-top: 2px; }
        .stat-sub { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
        .panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 16px; margin-bottom: 18px; }
        .panel-title { font-size: 14px; font-weight: 800; color: var(--color-deep); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px; }
        .field label { display: block; font-size: 11px; font-weight: 700; color: var(--color-text-muted); margin-bottom: 4px; }
        .field input, .field select { width: 100%; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--color-border); font-size: 12.5px; font-family: inherit; color: var(--color-text); background: white; }
        .field input:focus, .field select:focus { outline: none; border-color: var(--color-primary); }
        .gasto-row { display: grid; grid-template-columns: 1fr 110px 30px; gap: 8px; margin-bottom: 6px; align-items: center; }
        .icon-btn { border: none; background: var(--color-bg); border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-text-muted); }
        .icon-btn:hover { background: var(--color-border); color: var(--color-danger); }
        .btn { border: none; border-radius: 8px; padding: 8px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .btn-primary { background: var(--color-primary); color: white; }
        .btn-primary:hover { background: var(--color-primary-dark); }
        .btn-primary:disabled { background: var(--color-border); color: var(--color-text-muted); cursor: not-allowed; }
        .receipt-box { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 10px; padding: 12px 14px; margin-top: 4px; }
        .receipt-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
        .receipt-muted { color: var(--color-text-muted); font-size: 11.5px; }
        .receipt-divider { height: 1px; background: var(--color-border); margin: 6px 0; }
        .receipt-status { text-align: center; font-weight: 800; font-size: 13px; padding: 6px 0; border-radius: 6px; }
        .receipt-status.success { color: var(--color-success); background: #E7F7EE; }
        .receipt-status.danger { color: var(--color-danger); background: #FBE9E9; }
        .receipt-status.neutral { color: var(--color-text-muted); background: transparent; }
        .btn-ghost { background: var(--color-bg); color: var(--color-text); }
        .btn-ghost:hover { background: var(--color-border); }
        .btn-sm { padding: 5px 10px; font-size: 11.5px; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-text-muted); padding: 8px 10px; border-bottom: 2px solid var(--color-border); }
        td { padding: 9px 10px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        .row-expand-btn { border: none; background: transparent; cursor: pointer; color: var(--color-text-muted); display: flex; align-items: center; }
        .subtable-wrap { background: var(--color-bg); padding: 10px 14px; border-radius: 8px; margin: 6px 0 10px 0; }
        .badge { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; display: inline-block; white-space: nowrap; }
        .badge-success { background: #E7F7EE; color: var(--color-success); }
        .badge-warning { background: #FDF3E3; color: var(--color-warning); }
        .badge-danger { background: #FBE9E9; color: var(--color-danger); }
        .badge-neutral { background: #EEF1F5; color: var(--color-text-muted); }
        .badge-primary { background: #E7F0FC; color: var(--color-primary); }
        .signal-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 20px; }
        .signal-bar { width: 4px; border-radius: 1px; }
        .empty-state { text-align: center; padding: 34px 10px; color: var(--color-text-muted); font-size: 13px; }
        .cuota-chip { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; background: white; border: 1px solid var(--color-border); margin-bottom: 6px; font-size: 12px; }
        .cuota-chip.pagado { opacity: 0.55; }
        .checkbox-btn { width: 20px; height: 20px; border-radius: 5px; border: 1.5px solid var(--color-border); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
        .checkbox-btn.checked { background: var(--color-success); border-color: var(--color-success); color: white; }
        .progress-track { background: var(--color-border); border-radius: 999px; height: 6px; width: 100%; overflow: hidden; }
        .progress-fill { background: var(--color-primary); height: 100%; }
        .link-btn { border: none; background: none; color: var(--color-danger); cursor: pointer; font-size: 11.5px; font-weight: 700; }
        .type-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .type-card { border: 1.5px solid var(--color-border); background: white; border-radius: 10px; padding: 14px 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--color-text-muted); }
        .type-card.selected { border-color: var(--color-primary); background: #E7F0FC; color: var(--color-primary-dark); }
        .subtype-toggle { display: flex; gap: 8px; margin-bottom: 12px; }
        .subtype-toggle button { flex: 1; border: 1.5px solid var(--color-border); background: white; border-radius: 8px; padding: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; color: var(--color-text-muted); }
        .subtype-toggle button.selected { border-color: var(--color-primary); background: var(--color-primary); color: white; }
        .cart-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--color-border); font-size: 12.5px; }
        .cat-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
        .cat-tab { border: 1px solid var(--color-border); background: white; padding: 5px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; cursor: pointer; color: var(--color-text-muted); }
        .cat-tab.active { background: var(--color-deep); color: white; border-color: var(--color-deep); }
        .tasa-bar { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .tasa-badge {
          display: inline-flex; align-items: center; gap: 6px;
          border: 1px solid var(--color-border); background: var(--color-surface);
          border-radius: 999px; padding: 6px 12px; font-size: 12px; color: var(--color-text);
          cursor: pointer;
        }
        .tasa-badge:hover { border-color: var(--color-primary); }
        .tasa-badge-editing { cursor: default; background: #E7F0FC; border-color: var(--color-primary); }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-text">Punto Movistar</div>
            <div className="brand-sub">Control de negocio</div>
          </div>
        </div>
        {[
          { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
          { id: "clientes", label: "Clientes", icon: Users },
          { id: "ventas", label: "Ventas", icon: ShoppingCart },
          { id: "caja", label: "Caja", icon: Calculator },
          { id: "inventario", label: "Inventario", icon: Boxes },
          { id: "precios", label: "Lista de Precios", icon: Tag },
          { id: "compras", label: "Órdenes de Compra", icon: ClipboardList },
          { id: "pagar", label: "Cuentas por Pagar", icon: Receipt },
          { id: "creditos", label: "Créditos", icon: Smartphone },
          { id: "gastos", label: "Gastos", icon: Receipt },
          { id: "billetera", label: "Billetera", icon: Wallet },
        ].map((item) => (
          <button key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
        {supabaseConfigured && session && (
          <button
            className="nav-item"
            style={{ marginTop: "auto" }}
            onClick={() => supabase.auth.signOut()}
            title={session.user && session.user.email}
          >
            <LogOut size={16} />
            Cerrar sesión
          </button>
        )}
      </aside>

      <main className="main">
        <div className="main-header">
          <div className="main-title">
            {
              {
                dashboard: "Resumen general",
                clientes: "Historial de clientes",
                ventas: "Venta / Facturación",
                caja: "Caja",
                inventario: "Inventario y productos",
                precios: "Lista de Precios",
                compras: "Órdenes de Compra",
                pagar: "Cuentas por Pagar",
                creditos: "Créditos activos",
                gastos: "Gastos consolidados",
                billetera: "Billetera digital",
              }[tab]
            }
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {session && session.user && (
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{session.user.email}</span>
            )}
            <SyncStatus dataSync={dataSync} />
            <div className="currency-toggle">
              <button className={data.currency === "USD" ? "active" : ""} onClick={() => setData((d) => ({ ...d, currency: "USD" }))}>
                USD
              </button>
              <button className={data.currency === "VES" ? "active" : ""} onClick={() => setData((d) => ({ ...d, currency: "VES" }))}>
                Bs.
              </button>
            </div>
          </div>
        </div>

        {tab === "dashboard" && (
          <Dashboard
            data={data}
            setData={setData}
            metrics={metrics}
            money={money}
            chartData={chartData}
            gastosPorConcepto={gastosPorConcepto}
            ingresosPorMetodoPago={ingresosPorMetodoPago}
            PIE_COLORS={PIE_COLORS}
            bcvSync={bcvSync}
            syncTasaBCV={syncTasaBCV}
            setTab={setTab}
          />
        )}
        {tab === "clientes" && <Clientes data={data} setData={setData} money={money} />}
        {tab === "ventas" && <Ventas data={data} setData={setData} money={money} walletBalances={walletBalances} setTab={setTab} />}
        {tab === "caja" && <Caja data={data} setData={setData} money={money} />}
        {tab === "inventario" && <Inventario data={data} setData={setData} money={money} />}
        {tab === "precios" && <ListaPrecios data={data} setData={setData} />}
        {tab === "compras" && <Compras data={data} setData={setData} money={money} walletBalances={walletBalances} />}
        {tab === "pagar" && <CuentasPorPagar data={data} setData={setData} money={money} walletBalances={walletBalances} />}
        {tab === "creditos" && <Creditos data={data} setData={setData} money={money} />}
        {tab === "gastos" && <GastosView data={data} setData={setData} money={money} gastosPorConcepto={gastosPorConcepto} PIE_COLORS={PIE_COLORS} walletBalances={walletBalances} />}
        {tab === "billetera" && <Billetera data={data} setData={setData} walletBalances={walletBalances} />}
      </main>
    </div>
  );
}

// ==================== DASHBOARD ====================
function Dashboard({ data, setData, metrics, money, chartData, gastosPorConcepto, ingresosPorMetodoPago, PIE_COLORS, bcvSync, syncTasaBCV, setTab }) {
  return (
    <>
      <div className="tasa-bar" style={{ alignItems: "center" }}>
        <TasaBadge label="Tasa Interna" value={data.tasaInterna} onSave={(v) => setData((d) => ({ ...d, tasaInterna: v }))} />
        <TasaBadge label="Tasa BCV" value={data.tasaBCV} onSave={(v) => setData((d) => ({ ...d, tasaBCV: v }))} />
        <button className="icon-btn" title="Sincronizar tasa BCV ahora" onClick={syncTasaBCV} style={{ width: 26, height: 26 }}>
          <RefreshCw size={13} className={bcvSync && bcvSync.status === "loading" ? "spin" : ""} />
        </button>
        {bcvSync && bcvSync.status === "ok" && (
          <span style={{ fontSize: 10.5, color: "var(--color-text-muted)" }}>
            Sincronizado con BCV{bcvSync.fechaVigencia ? ` · vigente ${fmtDate(bcvSync.fechaVigencia)}` : ""}
          </span>
        )}
        {bcvSync && bcvSync.status === "error" && (
          <span style={{ fontSize: 10.5, color: "var(--color-danger)" }}>
            No se pudo sincronizar con BCV Today — verifica tu conexión, o ajusta la tasa manualmente.
          </span>
        )}
      </div>
      <div className="stat-grid">
        <Card icon={Wifi} tone="primary" label="Líneas nuevas activadas" value={metrics.countLineas} sub={`${money(metrics.totalComisiones)} en comisiones`} />
        <Card icon={TrendingUp} tone={metrics.gananciaLineas >= 0 ? "success" : "danger"} label="Ganancia líneas nuevas" value={money(metrics.gananciaLineas)} sub={`Gastos: ${money(metrics.totalGastosLineas)}`} />
        <Card icon={RefreshCw} tone={metrics.gananciaCambios >= 0 ? "success" : "danger"} label="Cambio/Recuperación de línea" value={metrics.countCambios} sub={`Ganancia: ${money(metrics.gananciaCambios)}`} />
        <Card icon={Package} tone="primary" label="Ganancia accesorios/repuestos" value={money(metrics.gananciaAccesorios)} sub={`${metrics.countAccesorios} ventas · ingresos ${money(metrics.ingresosAccesorios)}`} />
        <Card icon={Smartphone} tone="primary" label="Ganancia teléfonos de contado" value={money(metrics.gananciaTelContado)} sub={`${metrics.countTelContado} ventas`} />
        <Card icon={CreditCard} tone="primary" label="Créditos activos" value={metrics.countTelCredito} sub={`Por cobrar: ${money(metrics.montoPorCobrar)}`} />
        <Card icon={Wallet} tone="success" label="Ganancia total del negocio" value={money(metrics.gananciaTotal)} sub="Líneas + accesorios + teléfonos de contado" />
        <Card
          icon={AlertTriangle}
          tone={metrics.stockBajo.length ? "warning" : "success"}
          label="Productos con stock bajo"
          value={metrics.stockBajo.length}
          sub={metrics.stockBajo.length ? "Ver detalle en Inventario →" : "Todo en orden"}
          onClick={setTab ? () => setTab("inventario") : undefined}
        />
      </div>

      <div className="panel">
        <div className="panel-title">
          <TrendingUp size={16} /> Ventas y ganancia por mes
        </div>
        {chartData.length === 0 ? (
          <div className="empty-state">Aún no hay ventas registradas.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <Tooltip formatter={(v, name) => [money(v), name === "ventas" ? "Ventas" : "Ganancia"]} />
              <Bar dataKey="ventas" fill="#4FB6E8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ganancia" fill="#0A5FBF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: gastosPorConcepto.length && ingresosPorMetodoPago.length ? "1fr 1fr" : "1fr", gap: 16 }}>
        {gastosPorConcepto.length > 0 && (
          <div className="panel">
            <div className="panel-title">
              <Receipt size={16} /> Gastos de líneas nuevas
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={gastosPorConcepto} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={(e) => e.name}>
                  {gastosPorConcepto.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        {ingresosPorMetodoPago.length > 0 && (
          <div className="panel">
            <div className="panel-title">
              <CreditCard size={16} /> Cobros por método de pago
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={ingresosPorMetodoPago} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={(e) => e.name}>
                  {ingresosPorMetodoPago.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}

// ==================== CLIENTES ====================
function Clientes({ data, setData, money }) {
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({ nombre: "", cedula: "", telefono: "" });

  const addClient = () => {
    if (!form.nombre.trim()) return;
    setData((d) => ({ ...d, clients: upsertClient(d.clients, form) }));
    setForm({ nombre: "", cedula: "", telefono: "" });
  };
  const removeClient = (id) => setData((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }));

  const rows = data.clients.map((c) => {
    const cedulaNorm = (c.cedula || "").trim().toLowerCase();
    const ventas = data.sales.filter((s) => cedulaNorm && (s.clienteCedula || "").trim().toLowerCase() === cedulaNorm);
    const totalComision = ventas.filter((s) => s.tipo === "Línea Nueva").reduce((s, v) => s + (Number(v.comision) || 0), 0);
    return { ...c, ventas, totalComision };
  });

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <Plus size={16} /> Agregar cliente manualmente
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Nombre completo" />
          </div>
          <div className="field">
            <label>Cédula</label>
            <input value={form.cedula} onChange={(e) => setForm((f) => ({ ...f, cedula: e.target.value }))} placeholder="V-12345678" />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="0412-1234567" />
          </div>
        </div>
        <button className="btn btn-primary" onClick={addClient}>
          <Check size={14} /> Guardar cliente
        </button>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8 }}>
          Los clientes también se registran solos cada vez que facturas una venta nueva.
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <Users size={16} /> Clientes registrados ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">Aún no hay clientes. Se crean automáticamente al facturar una venta.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Cliente</th>
                <th>Cédula</th>
                <th>Teléfono</th>
                <th>Ventas</th>
                <th>Comisión generada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const isOpen = expanded === c.id;
                return (
                  <React.Fragment key={c.id}>
                    <tr>
                      <td>
                        <button className="row-expand-btn" onClick={() => setExpanded(isOpen ? null : c.id)}>
                          {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      </td>
                      <td style={{ fontWeight: 700 }}>{c.nombre}</td>
                      <td>{c.cedula || "-"}</td>
                      <td>{c.telefono || "-"}</td>
                      <td>
                        <Badge tone="primary">{c.ventas.length}</Badge>
                      </td>
                      <td>{money(c.totalComision)}</td>
                      <td>
                        <button className="link-btn" onClick={() => removeClient(c.id)}>
                          Eliminar
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ border: "none", padding: "0 10px 12px 10px" }}>
                          <div className="subtable-wrap">
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--color-text-muted)" }}>
                              Historial de ventas
                            </div>
                            {c.ventas.length === 0 ? (
                              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Sin ventas registradas todavía.</div>
                            ) : (
                              c.ventas.map((v) => (
                                <div key={v.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
                                  <span>
                                    {fmtDate(v.fecha)} · {v.tipo}
                                  </span>
                                  <span style={{ fontWeight: 700 }}>{money(v.ganancia)}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// Recibo numerado que se muestra justo después de facturar (carrito o teléfono a crédito),
// con los datos del cliente, lo que se llevó y cómo quedó pagado.
function ReciboFacturaView({ recibo, data, money, onCerrar }) {
  const r = recibo;
  return (
    <div className="panel" style={{ maxWidth: 520 }}>
      <div className="panel-title" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Receipt size={16} /> Factura N° {r.numero}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-text-muted)" }}>{fmtDate(r.fecha)}</span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{r.cliente.nombre}</div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {r.cliente.cedula ? `Cédula: ${r.cliente.cedula}` : "Sin cédula"} {r.cliente.telefono ? `· Tel: ${r.cliente.telefono}` : ""}
        </div>
      </div>

      <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>Se lleva</div>
      {r.items.map((it, i) => (
        <div className="cart-row" key={i}>
          <span style={{ flex: 1 }}>{it.descripcion}</span>
          <span style={{ fontWeight: 700 }}>{money(it.monto)}</span>
        </div>
      ))}

      <div className="receipt-box" style={{ marginTop: 12 }}>
        {r.descuento > 0.005 && (
          <>
            <div className="receipt-row receipt-muted">
              <span>Subtotal</span>
              <span>{money(r.totalBruto)}</span>
            </div>
            <div className="receipt-row receipt-muted">
              <span>Descuento</span>
              <span>− {money(r.descuento)}</span>
            </div>
          </>
        )}
        <div className="receipt-row">
          <span>Total</span>
          <span style={{ fontWeight: 800 }}>{money(r.total)}</span>
        </div>

        {r.pagos.length > 0 && (
          <>
            <div className="receipt-divider" />
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 4 }}>
              {r.esCredito ? "Inicial pagada con" : "Pagado con"}
            </div>
            {r.pagos.map((p, i) => (
              <div className="receipt-row" key={i}>
                <span>{p.metodo}</span>
                <span style={{ fontWeight: 700 }}>{fmtAccountAmount(p.monto, ACCOUNT_CURRENCY[METHOD_TO_ACCOUNT[p.metodo]])}</span>
              </div>
            ))}
          </>
        )}

        {r.esCashea && (
          <>
            <div className="receipt-divider" />
            <div className="receipt-row">
              <span>Inicial que pagó el cliente</span>
              <span style={{ fontWeight: 800 }}>{money(r.inicialCashea)}</span>
            </div>
            <div className="receipt-row">
              <span>Cashea financia</span>
              <span style={{ fontWeight: 800 }}>{money(r.financiadoCashea)}</span>
            </div>
            <div className="receipt-row receipt-muted">
              <span>Comisión Cashea ({CASHEA_GENERAL_COMISION_PCT}%)</span>
              <span>− {money(r.financiadoCashea - r.montoFinanciadoNetoCashea)}</span>
            </div>
            <div className="receipt-row">
              <span>Cashea te acreditará (neto)</span>
              <span style={{ fontWeight: 800, color: "var(--color-success)" }}>{money(r.montoFinanciadoNetoCashea)}</span>
            </div>
          </>
        )}

        {r.esCredito && (
          <>
            <div className="receipt-divider" />
            <div className="receipt-row">
              <span>Financiado ({r.plataformaCredito})</span>
              <span style={{ fontWeight: 800 }}>{money(r.total - r.cobrado)}</span>
            </div>
            <div className="receipt-row">
              <span>Cuotas</span>
              <span style={{ fontWeight: 800 }}>
                {r.numeroCuotas} de {money(r.montoCuota)}
              </span>
            </div>
          </>
        )}

        {!r.esCashea && !r.esCredito && r.cobrado - r.total > 0.01 && (
          <>
            <div className="receipt-divider" />
            <div className="receipt-status success">Vuelto a entregar: {money(r.cobrado - r.total)}</div>
          </>
        )}
      </div>

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={onCerrar}>
        <Check size={14} /> Nueva venta
      </button>
    </div>
  );
}

// ==================== VENTAS / FACTURACIÓN ====================
function Ventas({ data, setData, money, walletBalances, setTab }) {
  const [cliente, setCliente] = useState({ nombre: "", cedula: "", telefono: "" });
  const [step, setStep] = useState("cliente");
  const [tipoVenta, setTipoVenta] = useState(null);
  const [history, setHistory] = useState(false);
  const [carritoFactura, setCarritoFactura] = useState([]);
  const [pagoFactura, setPagoFactura] = useState(paymentDefault());
  const [descuento, setDescuento] = useState("");
  const [descuentoMoneda, setDescuentoMoneda] = useState(data.currency);
  const [reciboFactura, setReciboFactura] = useState(null);
  const [confirmarEliminarId, setConfirmarEliminarId] = useState(null);

  // Línea nueva
  const [planId, setPlanId] = useState("");
  const [comision, setComision] = useState("");
  const [simCategoria, setSimCategoria] = useState("SIM Card");
  const [montoRecarga, setMontoRecarga] = useState("");
  const [montoRecargaMoneda, setMontoRecargaMoneda] = useState(data.currency);

  // Cambio o recuperación de línea
  const [cambioCategoria, setCambioCategoria] = useState("SIM Card");
  const [cambioPrecio, setCambioPrecio] = useState("10");
  const [cambioPrecioMoneda, setCambioPrecioMoneda] = useState(data.currency);

  // Accesorios
  const [accProductId, setAccProductId] = useState("");
  const [accCantidad, setAccCantidad] = useState(1);

  // Teléfono
  const [telSubTipo, setTelSubTipo] = useState("contado");
  const [telProductId, setTelProductId] = useState("");
  const [precioContado, setPrecioContado] = useState("");
  const [precioContadoMoneda, setPrecioContadoMoneda] = useState(data.currency);
  const [creditoInicial, setCreditoInicial] = useState("");
  const [creditoCuotas, setCreditoCuotas] = useState(3);
  const [creditoFecha, setCreditoFecha] = useState(todayISO());
  const [pagoInicialCredito, setPagoInicialCredito] = useState(paymentDefault());
  const [creditoPlataforma, setCreditoPlataforma] = useState("Crédito propio");
  const [creditoComisionPct, setCreditoComisionPct] = useState("");

  const cedulaMatch = (cedula) => {
    const norm = (cedula || "").trim().toLowerCase();
    if (!norm) return null;
    return data.clients.find((c) => (c.cedula || "").trim().toLowerCase() === norm) || null;
  };

  const onCedulaBlur = () => {
    const match = cedulaMatch(cliente.cedula);
    if (match && !cliente.nombre) {
      setCliente({ nombre: match.nombre, cedula: match.cedula, telefono: match.telefono });
    }
  };

  const resetFormularioItem = () => {
    setTipoVenta(null);
    setPlanId("");
    setComision("");
    setSimCategoria("SIM Card");
    setMontoRecarga("");
    setMontoRecargaMoneda(data.currency);
    setCambioCategoria("SIM Card");
    setCambioPrecio("10");
    setCambioPrecioMoneda(data.currency);
    setAccProductId("");
    setAccCantidad(1);
    setTelSubTipo("contado");
    setTelProductId("");
    setPrecioContado("");
    setPrecioContadoMoneda(data.currency);
    setCreditoInicial("");
    setCreditoCuotas(3);
    setCreditoFecha(todayISO());
    setPagoInicialCredito(paymentDefault());
    setCreditoPlataforma("Crédito propio");
    setCreditoComisionPct("");
  };

  const finalizarFactura = () => {
    setCliente({ nombre: "", cedula: "", telefono: "" });
    setCarritoFactura([]);
    setPagoFactura(paymentDefault());
    setDescuento("");
    setDescuentoMoneda(data.currency);
    setStep("cliente");
    resetFormularioItem();
  };

  const simProductsByCategoria = (cat) => data.products.filter((p) => p.categoria === cat);
  const simProductActual = simProductsByCategoria(simCategoria).find((p) => Number(p.stock) > 0) || simProductsByCategoria(simCategoria)[0];
  const cambioProductActual = simProductsByCategoria(cambioCategoria).find((p) => Number(p.stock) > 0) || simProductsByCategoria(cambioCategoria)[0];
  const accProducts = data.products.filter((p) => p.categoria === "Accesorio" || p.categoria === "Repuestos");
  const telProducts = data.products.filter((p) => p.categoria === "Teléfono");

  const quitarDelCarrito = (key) => setCarritoFactura((its) => its.filter((it) => it.key !== key));

  // ---------- Línea nueva → agregar al carrito ----------
  const agregarLinea = () => {
    if (!(Number(montoRecarga) >= 0)) return;
    const plan = data.planes.find((p) => p.id === planId);
    const sim = simProductActual;
    const costoSim = sim ? Number(sim.costo) || 0 : 0;
    const comisionNum = Number(comision) || 0;
    // La recarga es un monto de paso (lo que se le cobra al cliente para la recarga, sin margen),
    // así que debe convertirse a la misma tasa (BCV) que se usa para comparar contra lo cobrado —
    // si se usara la tasa interna, el mismo monto en Bs. no cuadraría con "Monto cobrado" y
    // aparecería un vuelto o un faltante que en realidad no existe.
    const monto = convertAmountCurrency(montoRecarga, montoRecargaMoneda, data.currency, data.tasaBCV);
    // Guardamos también el monto EXACTO en Bs. que se cobró (tal cual se escribió, sin volver a
    // convertirlo más adelante) para que Opercoll descuente siempre lo mismo que se cobró — si se
    // recalculara con la tasa BCV vigente en otro momento, un cambio de tasa haría que el
    // descuento de Opercoll ya no coincidiera con el monto real cobrado.
    const montoRecargaBs = montoRecargaMoneda === "VES" ? Number(montoRecarga) || 0 : (Number(montoRecarga) || 0) * (Number(data.tasaBCV) || 1);
    setCarritoFactura((its) => [
      ...its,
      {
        key: uid(),
        tipo: "Línea Nueva",
        descripcion: `Línea nueva${plan ? " · " + plan.nombre : ""}`,
        montoCliente: monto,
        payload: {
          planNombre: plan ? plan.nombre : "",
          comision: comisionNum,
          simCategoria,
          simProductId: sim ? sim.id : null,
          simNombre: sim ? sim.nombre : simCategoria,
          costoSim,
          montoRecarga: monto,
          montoRecargaBs,
        },
      },
    ]);
    setPlanId("");
    setComision("");
    setMontoRecarga("");
  };

  // ---------- Cambio o recuperación → agregar al carrito ----------
  const agregarCambio = () => {
    const sim = cambioProductActual;
    const costoSim = sim ? Number(sim.costo) || 0 : 0;
    const precioServicio = convertAmountCurrency(cambioPrecio, cambioPrecioMoneda, data.currency, data.tasaInterna);
    setCarritoFactura((its) => [
      ...its,
      {
        key: uid(),
        tipo: "Cambio/Recuperación de Línea",
        descripcion: `Cambio/Recuperación de línea (${cambioCategoria})`,
        montoCliente: precioServicio,
        payload: { simCategoria: cambioCategoria, simProductId: sim ? sim.id : null, simNombre: sim ? sim.nombre : cambioCategoria, costoSim, precioServicio },
      },
    ]);
    setCambioCategoria("SIM Card");
    setCambioPrecio("10");
  };

  // ---------- Accesorios → agregar al carrito ----------
  const agregarAccesorio = () => {
    const prod = data.products.find((p) => p.id === accProductId);
    if (!prod || !(Number(accCantidad) > 0)) return;
    const cantidad = Number(accCantidad);
    const precioUnit = Number(prod.precioVenta) || 0;
    const costoUnit = Number(prod.costo) || 0;
    setCarritoFactura((its) => [
      ...its,
      {
        key: uid(),
        tipo: "Accesorios",
        descripcion: `${prod.nombre} × ${cantidad}`,
        montoCliente: precioUnit * cantidad,
        payload: { productId: prod.id, nombre: prod.nombre, cantidad, precioUnit, costoUnit },
      },
    ]);
    setAccProductId("");
    setAccCantidad(1);
  };

  // ---------- Teléfono de contado → agregar al carrito ----------
  const agregarTelContado = () => {
    const prod = data.products.find((p) => p.id === telProductId);
    if (!prod) return;
    const precioVenta = precioContado !== "" ? convertAmountCurrency(precioContado, precioContadoMoneda, data.currency, data.tasaInterna) : Number(prod.precioVenta) || 0;
    const costo = Number(prod.costo) || 0;
    setCarritoFactura((its) => [
      ...its,
      {
        key: uid(),
        tipo: "Teléfono Contado",
        descripcion: prod.nombre,
        montoCliente: precioVenta,
        payload: { productId: prod.id, nombre: prod.nombre, costo, precioVenta },
      },
    ]);
    setTelProductId("");
    setPrecioContado("");
  };

  // ---------- Facturar todo el carrito junto ----------
  const ventasHistorial = data.sales.filter((s) => s.tipo !== "Financiamiento Cashea");
  const totalCarritoBruto = carritoFactura.reduce((s, it) => s + it.montoCliente, 0);
  // Descuento manual por si toca negociar el precio con el cliente — se resta del total antes
  // de comparar contra lo cobrado, y luego se reparte proporcionalmente entre los ítems para
  // que la ganancia registrada de cada uno refleje lo que realmente se le rebajó al cliente.
  const descuentoValor = Math.min(totalCarritoBruto, Math.max(0, convertAmountCurrency(descuento, descuentoMoneda, data.currency, data.tasaBCV)));
  const totalCarrito = totalCarritoBruto - descuentoValor;
  const pagosFactura = buildPagos(pagoFactura);
  const esCasheaFactura = pagoFactura.medioPago === "Cashea";
  // Las baterías (dentro de Repuestos/Accesorios) se cobran a tasa interna, no a tasa BCV como el
  // resto de la factura. Si el carrito mezcla baterías con otros ítems, el pago en Bs. se reparte
  // proporcionalmente entre ambas tasas según qué fracción de la factura son baterías.
  const esItemBateria = (it) => it.tipo === "Accesorios" && /bateria|batería/i.test((it.payload && it.payload.nombre) || "");
  const totalCarritoBaterias = carritoFactura.filter(esItemBateria).reduce((s, it) => s + it.montoCliente, 0);
  const bateriaShareFactura = totalCarritoBruto > 0 ? totalCarritoBaterias / totalCarritoBruto : 0;
  const pagosFacturaBsMonto = pagosFactura.filter((p) => BS_METHODS.includes(p.metodo)).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const pagosFacturaUsdMonto = pagosFactura.filter((p) => !BS_METHODS.includes(p.metodo)).reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const cobradoFactura =
    pagosFacturaUsdMonto +
    (pagosFacturaBsMonto * bateriaShareFactura) / (Number(data.tasaInterna) || 1) +
    (pagosFacturaBsMonto * (1 - bateriaShareFactura)) / (Number(data.tasaBCV) || 1);
  const cobradoFacturaReal = pagosNativeTotal(pagosFactura, data.currency, data.tasaInterna);
  // Con Cashea, lo que se escribe en "monto cobrado" es la inicial que paga el cliente — el resto
  // lo financia Cashea (menos su comisión fija), así que la factura se puede cerrar sin cobrar el 100%.
  const inicialCashea = esCasheaFactura ? Math.min(cobradoFactura, totalCarrito) : 0;
  const financiadoCashea = esCasheaFactura ? Math.max(0, totalCarrito - inicialCashea) : 0;
  const montoFinanciadoNetoCashea = Number((financiadoCashea * (1 - CASHEA_GENERAL_COMISION_PCT / 100)).toFixed(2));
  const diffFactura = totalCarrito - cobradoFactura;
  // Bs. que faltan por cobrar, usando la misma mezcla de tasas (interna para la parte de baterías).
  const diffFacturaBs = diffFactura * bateriaShareFactura * (Number(data.tasaInterna) || 1) + diffFactura * (1 - bateriaShareFactura) * (Number(data.tasaBCV) || 1);
  const facturaCompleta = carritoFactura.length > 0 && (esCasheaFactura ? cobradoFactura <= totalCarrito + 0.01 : diffFactura <= 0.01);

  const facturarCarrito = () => {
    if (!cliente.nombre.trim() || !facturaCompleta) return;
    const grupoId = uid();
    // Si hay descuento, el dinero realmente cobrado alcanza para menos que el precio de lista de
    // cada ítem — se reparte el pago sobre una versión "encogida" del carrito (misma proporción
    // entre ítems, pero sumando el total ya descontado) para que la asignación por método/cuenta
    // de pago cuadre con lo que en verdad entró a cada cuenta.
    const carritoParaPago =
      descuentoValor > 0.005 && totalCarritoBruto > 0
        ? carritoFactura.map((it) => ({ ...it, montoCliente: (it.montoCliente / totalCarritoBruto) * totalCarrito }))
        : carritoFactura;
    const asignaciones = distribuirPagoEntreItems(carritoParaPago, pagosFactura, data.currency, data.tasaInterna);
    // Cuánto del descuento total le toca absorber a cada ítem, en proporción a lo que representaba
    // del total de la factura antes de descontar — se resta de su ganancia registrada.
    const descuentoDeItem = (it) => (totalCarritoBruto > 0 ? (it.montoCliente / totalCarritoBruto) * descuentoValor : 0);

    const nuevasVentas = [];
    let products = data.products;
    const accesorioItems = carritoFactura.filter((it) => it.tipo === "Accesorios");

    carritoFactura.forEach((it) => {
      if (it.tipo === "Accesorios") return; // se agrupan todos en un solo registro más abajo
      const pagos = asignaciones[it.key] || [];
      if (it.tipo === "Línea Nueva") {
        nuevasVentas.push({
          id: uid(),
          fecha: todayISO(),
          facturaGrupoId: grupoId,
          tipo: "Línea Nueva",
          clienteNombre: cliente.nombre,
          clienteCedula: cliente.cedula,
          clienteTelefono: cliente.telefono,
          planNombre: it.payload.planNombre,
          comision: it.payload.comision,
          simCategoria: it.payload.simCategoria,
          simProductId: it.payload.simProductId,
          simNombre: it.payload.simNombre,
          costoSim: it.payload.costoSim,
          montoRecarga: it.payload.montoRecarga,
          montoRecargaBs: it.payload.montoRecargaBs,
          pagos,
          ganancia: it.payload.comision - it.payload.costoSim - descuentoDeItem(it),
        });
        if (it.payload.simProductId) products = decrementStock(products, it.payload.simProductId, 1);
      } else if (it.tipo === "Cambio/Recuperación de Línea") {
        nuevasVentas.push({
          id: uid(),
          fecha: todayISO(),
          facturaGrupoId: grupoId,
          tipo: "Cambio/Recuperación de Línea",
          clienteNombre: cliente.nombre,
          clienteCedula: cliente.cedula,
          clienteTelefono: cliente.telefono,
          simCategoria: it.payload.simCategoria,
          simProductId: it.payload.simProductId,
          simNombre: it.payload.simNombre,
          costoSim: it.payload.costoSim,
          precioServicio: it.payload.precioServicio,
          pagos,
          ganancia: it.payload.precioServicio - it.payload.costoSim - descuentoDeItem(it),
        });
        if (it.payload.simProductId) products = decrementStock(products, it.payload.simProductId, 1);
      } else if (it.tipo === "Teléfono Contado") {
        nuevasVentas.push({
          id: uid(),
          fecha: todayISO(),
          facturaGrupoId: grupoId,
          tipo: "Teléfono Contado",
          clienteNombre: cliente.nombre,
          clienteCedula: cliente.cedula,
          clienteTelefono: cliente.telefono,
          productId: it.payload.productId,
          nombre: it.payload.nombre,
          costo: it.payload.costo,
          precioVenta: it.payload.precioVenta,
          pagos,
          ganancia: it.payload.precioVenta - it.payload.costo - descuentoDeItem(it),
        });
        products = decrementStock(products, it.payload.productId, 1);
      }
    });

    if (accesorioItems.length > 0) {
      const pagosAccesorios = accesorioItems.flatMap((it) => asignaciones[it.key] || []);
      const items = accesorioItems.map((it) => it.payload);
      const ganancia = accesorioItems.reduce(
        (s, it) => s + (it.payload.precioUnit - it.payload.costoUnit) * it.payload.cantidad - descuentoDeItem(it),
        0
      );
      nuevasVentas.push({
        id: uid(),
        fecha: todayISO(),
        facturaGrupoId: grupoId,
        tipo: "Accesorios",
        clienteNombre: cliente.nombre,
        clienteCedula: cliente.cedula,
        clienteTelefono: cliente.telefono,
        items,
        pagos: pagosAccesorios,
        ganancia,
      });
      accesorioItems.forEach((it) => {
        products = decrementStock(products, it.payload.productId, it.payload.cantidad);
      });
    }

    if (esCasheaFactura && financiadoCashea > 0.01) {
      nuevasVentas.push({
        id: uid(),
        fecha: todayISO(),
        facturaGrupoId: grupoId,
        tipo: "Financiamiento Cashea",
        clienteNombre: cliente.nombre,
        clienteCedula: cliente.cedula,
        clienteTelefono: cliente.telefono,
        montoFinanciado: financiadoCashea,
        comisionPct: CASHEA_GENERAL_COMISION_PCT,
        montoFinanciadoNeto: montoFinanciadoNetoCashea,
        plataforma: "Cashea",
        liquidado: false,
        fechaLiquidacion: null,
        ganancia: 0,
      });
    }

    const numeroFactura = (data.ultimoNumeroFactura || 0) + 1;
    const nuevasVentasNumeradas = nuevasVentas.map((v) => ({ ...v, numeroFactura }));

    setData((d) => ({
      ...d,
      sales: [...nuevasVentasNumeradas, ...d.sales],
      clients: upsertClient(d.clients, cliente),
      products,
      ultimoNumeroFactura: numeroFactura,
    }));

    setReciboFactura({
      numero: numeroFactura,
      fecha: todayISO(),
      cliente: { ...cliente },
      items: carritoFactura.map((it) => ({ descripcion: it.descripcion || it.tipo, monto: it.montoCliente })),
      pagos: pagosFactura,
      totalBruto: totalCarritoBruto,
      descuento: descuentoValor,
      total: totalCarrito,
      cobrado: cobradoFactura,
      esCashea: esCasheaFactura,
      inicialCashea,
      financiadoCashea,
      montoFinanciadoNetoCashea,
    });

    setCliente({ nombre: "", cedula: "", telefono: "" });
    setCarritoFactura([]);
    setPagoFactura(paymentDefault());
    setDescuento("");
    setDescuentoMoneda(data.currency);
    setStep("cliente");
    resetFormularioItem();
  };

  // ---------- Teléfono crédito (financiamiento, se factura aparte de inmediato) ----------
  const submitTelCredito = () => {
    const prod = data.products.find((p) => p.id === telProductId);
    if (!cliente.nombre.trim() || !prod) return;
    const precioTotal = Number(prod.precioVenta) || 0;
    const costoTelefono = Number(prod.costo) || 0;
    const inicial = Number(creditoInicial) || 0;
    const n = Number(creditoCuotas) || 1;
    const montoCuota = Math.max(0, (precioTotal - inicial) / n);
    const comisionPct = creditoPlataforma === "Crédito propio" ? 0 : Number(creditoComisionPct) || 0;
    const cuotas = Array.from({ length: n }, (_, i) => {
      const monto = Number(montoCuota.toFixed(2));
      return {
        numero: i + 1,
        fechaVencimiento: addMonths(creditoFecha, i),
        monto,
        montoNeto: Number((monto * (1 - comisionPct / 100)).toFixed(2)),
        pagado: false,
        fechaPago: null,
      };
    });
    const saleId = uid();
    const creditId = uid();
    const pagos = inicial > 0 ? buildPagos(pagoInicialCredito).map((p) => ({ ...p, fecha: todayISO() })) : [];
    const financiado = precioTotal - inicial;
    const montoFinanciadoNeto = Number((financiado * (1 - comisionPct / 100)).toFixed(2));
    const numeroFactura = (data.ultimoNumeroFactura || 0) + 1;
    const saleRecord = {
      id: saleId,
      fecha: todayISO(),
      facturaGrupoId: uid(),
      numeroFactura,
      tipo: "Teléfono Crédito",
      clienteNombre: cliente.nombre,
      clienteCedula: cliente.cedula,
      clienteTelefono: cliente.telefono,
      productId: prod.id,
      nombre: prod.nombre,
      costo: costoTelefono,
      precioVenta: precioTotal,
      inicial,
      numeroCuotas: n,
      creditId,
      pagos,
      plataforma: creditoPlataforma,
      montoFinanciadoNeto,
      liquidado: false,
      fechaLiquidacion: null,
      ganancia: precioTotal - costoTelefono,
    };
    const creditRecord = {
      id: creditId,
      saleId,
      cliente: cliente.nombre,
      cedula: cliente.cedula,
      telefono: prod.nombre,
      costoTelefono,
      precioTotal,
      inicial,
      fecha: todayISO(),
      plataforma: creditoPlataforma,
      comisionPct,
      cuotas,
    };
    setData((d) => ({
      ...d,
      sales: [saleRecord, ...d.sales],
      credits: [creditRecord, ...d.credits],
      clients: upsertClient(d.clients, cliente),
      products: decrementStock(d.products, prod.id, 1),
      ultimoNumeroFactura: numeroFactura,
    }));

    setReciboFactura({
      numero: numeroFactura,
      fecha: todayISO(),
      cliente: { ...cliente },
      items: [{ descripcion: `Teléfono a crédito · ${prod.nombre}`, monto: precioTotal }],
      pagos,
      totalBruto: precioTotal,
      descuento: 0,
      total: precioTotal,
      cobrado: inicial,
      esCashea: false,
      esCredito: true,
      plataformaCredito: creditoPlataforma,
      numeroCuotas: n,
      montoCuota,
    });

    setCliente({ nombre: "", cedula: "", telefono: "" });
    setStep("cliente");
    resetFormularioItem();
  };

  // ---------- Eliminar una venta del historial (para corregir errores y rehacerla) ----------
  // Revierte lo que esa venta afectó: devuelve el stock del producto/SIM que se descontó, y si
  // era un teléfono a crédito, también elimina su cronograma de cuotas asociado. La comisión,
  // ganancia y el consumo de cuentas (Opercoll, etc.) se recalculan solos porque se derivan de
  // data.sales en cada render — no hay que revertirlos a mano.
  const eliminarVenta = (sale) => {
    setConfirmarEliminarId(null);
    setData((d) => {
      let products = d.products;
      if ((sale.tipo === "Línea Nueva" || sale.tipo === "Cambio/Recuperación de Línea") && sale.simProductId) {
        products = products.map((p) => (p.id === sale.simProductId ? { ...p, stock: Number(p.stock) + 1 } : p));
      } else if (sale.tipo === "Teléfono Contado" || sale.tipo === "Teléfono Crédito") {
        products = products.map((p) => (p.id === sale.productId ? { ...p, stock: Number(p.stock) + 1 } : p));
      } else if (sale.tipo === "Accesorios") {
        (sale.items || []).forEach((it) => {
          products = products.map((p) => (p.id === it.productId ? { ...p, stock: Number(p.stock) + (Number(it.cantidad) || 0) } : p));
        });
      }
      const credits = sale.tipo === "Teléfono Crédito" ? d.credits.filter((c) => c.id !== sale.creditId) : d.credits;
      return {
        ...d,
        sales: d.sales.filter((s) => s.id !== sale.id),
        products,
        credits,
      };
    });
  };

  if (reciboFactura) {
    return <ReciboFacturaView recibo={reciboFactura} data={data} money={money} onCerrar={() => setReciboFactura(null)} />;
  }

  const fechasPendientesCierre = getFechasPendientesCierre(data);

  if (fechasPendientesCierre.length > 0) {
    return (
      <div className="panel">
        <div className="panel-title">
          <Lock size={16} /> Cierre de caja pendiente
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>
          No puedes registrar nuevas ventas hasta cerrar la caja de{" "}
          {fechasPendientesCierre.length === 1 ? "este día" : "estos días"}:
        </div>
        <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
          {fechasPendientesCierre.map((f) => (
            <li key={f} style={{ fontWeight: 700, marginBottom: 4 }}>
              {fmtDate(f)}
            </li>
          ))}
        </ul>
        <button className="btn btn-primary" onClick={() => setTab && setTab("caja")}>
          <Calculator size={14} /> Ir a Caja para cerrar
        </button>
      </div>
    );
  }

  return (
    <>
      {step === "cliente" ? (
        <div className="panel">
          <div className="panel-title">
            <Users size={16} /> 1. Datos del cliente
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Cédula</label>
              <input value={cliente.cedula} onChange={(e) => setCliente((c) => ({ ...c, cedula: e.target.value }))} onBlur={onCedulaBlur} placeholder="V-12345678" />
            </div>
            <div className="field">
              <label>Nombre</label>
              <BuscadorCliente
                clients={data.clients}
                value={cliente.nombre}
                onChange={(v) => setCliente((c) => ({ ...c, nombre: v }))}
                onSelect={(c) => setCliente({ nombre: c.nombre, cedula: c.cedula || "", telefono: c.telefono || "" })}
              />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input value={cliente.telefono} onChange={(e) => setCliente((c) => ({ ...c, telefono: e.target.value }))} placeholder="0412-1234567" />
            </div>
          </div>
          {cedulaMatch(cliente.cedula) && <Badge tone="success">Cliente existente encontrado</Badge>}
          {!cliente.nombre.trim() && <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8 }}>Escribe al menos el nombre del cliente para continuar.</div>}
          <br />
          <button className="btn btn-primary" disabled={!cliente.nombre.trim()} onClick={() => setStep("compra")} style={{ marginTop: 10 }}>
            Continuar <Check size={14} />
          </button>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-title" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={16} /> Cliente: {cliente.nombre}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep("cliente")}>
              Editar cliente
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {cliente.cedula ? `Cédula: ${cliente.cedula}` : "Sin cédula"} {cliente.telefono ? `· Tel: ${cliente.telefono}` : ""}
          </div>
        </div>
      )}

      {step === "compra" && (
      <>
      <div className="panel">
        <div className="panel-title">
          <ShoppingCart size={16} /> 2. ¿Qué está comprando?
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 12 }}>
          Agrega tantos productos o servicios de cualquier categoría como necesites — todo se suma en una sola factura para
          este cliente. El teléfono a crédito se factura aparte, ya que es un financiamiento independiente.
        </div>
        <div className="type-grid">
          <div className={`type-card ${tipoVenta === "linea" ? "selected" : ""}`} onClick={() => setTipoVenta("linea")}>
            <Wifi size={20} />
            Línea nueva
          </div>
          <div className={`type-card ${tipoVenta === "cambio" ? "selected" : ""}`} onClick={() => setTipoVenta("cambio")}>
            <RefreshCw size={20} />
            Cambio / Recuperación de línea
          </div>
          <div className={`type-card ${tipoVenta === "accesorios" ? "selected" : ""}`} onClick={() => setTipoVenta("accesorios")}>
            <Package size={20} />
            Accesorios / Repuestos
          </div>
          <div className={`type-card ${tipoVenta === "telefono" ? "selected" : ""}`} onClick={() => setTipoVenta("telefono")}>
            <Smartphone size={20} />
            Teléfono
          </div>
        </div>

        {tipoVenta === "linea" && (
          <div>
            <div className="form-grid">
              <div className="field">
                <label>Plan</label>
                <select
                  value={planId}
                  onChange={(e) => {
                    setPlanId(e.target.value);
                    const p = data.planes.find((pl) => pl.id === e.target.value);
                    if (p) setComision(convertBs(p.comisionBs, data.currency, data.tasaBCV).toFixed(2));
                  }}
                >
                  <option value="">Seleccionar plan...</option>
                  {data.planes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} (comisión {money(convertBs(p.comisionBs, data.currency, data.tasaBCV))})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Comisión Movistar</label>
                <input type="number" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="0.00" />
              </div>
              <div className="field">
                <label>SIM Card o eSIM entregada</label>
                <select value={simCategoria} onChange={(e) => setSimCategoria(e.target.value)}>
                  <option value="SIM Card">SIM Card</option>
                  <option value="eSIM">eSIM</option>
                </select>
                {simProductActual ? (
                  <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {simProductActual.nombre} · costo {money(simProductActual.costo)} · stock {simProductActual.stock}
                  </div>
                ) : (
                  <div style={{ fontSize: 10.5, color: "var(--color-danger)", marginTop: 4 }}>
                    Sin producto registrado en Inventario para esta categoría
                  </div>
                )}
              </div>
              <div className="field">
                <label>Recarga a cobrar</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" value={montoRecarga} onChange={(e) => setMontoRecarga(e.target.value)} placeholder="0.00" />
                  <MonedaToggle value={montoRecargaMoneda} onChange={setMontoRecargaMoneda} />
                </div>
              </div>
            </div>
            {walletBalances && (
              <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginBottom: 10 }}>
                Saldo disponible en Opercoll: {fmtAccountAmount(walletBalances["Opercoll"] || 0, "VES")}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={agregarLinea}>
              <Plus size={13} /> Agregar a la factura
            </button>
          </div>
        )}

        {tipoVenta === "cambio" && (
          <div>
            <div className="form-grid">
              <div className="field">
                <label>SIM Card o eSIM usada</label>
                <select value={cambioCategoria} onChange={(e) => setCambioCategoria(e.target.value)}>
                  <option value="SIM Card">SIM Card</option>
                  <option value="eSIM">eSIM</option>
                </select>
                {cambioProductActual ? (
                  <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                    {cambioProductActual.nombre} · costo {money(cambioProductActual.costo)} · stock {cambioProductActual.stock}
                  </div>
                ) : (
                  <div style={{ fontSize: 10.5, color: "var(--color-danger)", marginTop: 4 }}>
                    Sin producto registrado en Inventario para esta categoría
                  </div>
                )}
              </div>
              <div className="field">
                <label>Precio del servicio</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" value={cambioPrecio} onChange={(e) => setCambioPrecio(e.target.value)} placeholder="10.00" />
                  <MonedaToggle value={cambioPrecioMoneda} onChange={setCambioPrecioMoneda} />
                </div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={agregarCambio}>
              <Plus size={13} /> Agregar a la factura
            </button>
          </div>
        )}

        {tipoVenta === "accesorios" && (
          <div>
            <div className="form-grid">
              <div className="field">
                <label>Producto</label>
                <BuscadorProducto
                  products={accProducts}
                  value={accProductId}
                  onChange={setAccProductId}
                  placeholder="Buscar accesorio o repuesto por nombre..."
                  renderLabel={(p) => `${p.nombre} · ${p.categoria} (${money(p.precioVenta)} · stock ${p.stock})`}
                />
              </div>
              <div className="field">
                <label>Cantidad</label>
                <input type="number" min={1} value={accCantidad} onChange={(e) => setAccCantidad(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={agregarAccesorio}>
              <Plus size={13} /> Agregar al carrito
            </button>
          </div>
        )}

        {tipoVenta === "telefono" && (
          <div>
            <div className="subtype-toggle">
              <button className={telSubTipo === "contado" ? "selected" : ""} onClick={() => setTelSubTipo("contado")}>
                De contado
              </button>
              <button className={telSubTipo === "credito" ? "selected" : ""} onClick={() => setTelSubTipo("credito")}>
                A crédito
              </button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Equipo</label>
                <BuscadorProducto
                  products={telProducts}
                  value={telProductId}
                  onChange={setTelProductId}
                  placeholder="Buscar teléfono por nombre..."
                  renderLabel={(p) => `${p.nombre} (${money(p.precioVenta)} · stock ${p.stock})`}
                />
              </div>
              {telSubTipo === "contado" && (
                <div className="field">
                  <label>Precio a cobrar (editable)</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      value={precioContado}
                      onChange={(e) => setPrecioContado(e.target.value)}
                      placeholder={(() => {
                        const p = data.products.find((pp) => pp.id === telProductId);
                        return p ? String(p.precioVenta) : "0.00";
                      })()}
                    />
                    <MonedaToggle value={precioContadoMoneda} onChange={setPrecioContadoMoneda} />
                  </div>
                </div>
              )}
            </div>

            {telSubTipo === "contado" && (
              <button className="btn btn-ghost btn-sm" onClick={agregarTelContado}>
                <Plus size={13} /> Agregar a la factura
              </button>
            )}

            {telSubTipo === "credito" && (
              <>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>Plataforma de financiamiento</label>
                <div className="subtype-toggle" style={{ marginBottom: 12 }}>
                  {CREDIT_PLATFORMS.map((p) => (
                    <button
                      key={p}
                      className={creditoPlataforma === p ? "selected" : ""}
                      onClick={() => {
                        setCreditoPlataforma(p);
                        setCreditoComisionPct(p === "Crédito propio" ? "" : String(PLATFORM_COMMISSION_DEFAULT[p] || ""));
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>Inicial</label>
                    <input type="number" value={creditoInicial} onChange={(e) => setCreditoInicial(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="field">
                    <label>Número de cuotas</label>
                    <input type="number" min={1} value={creditoCuotas} onChange={(e) => setCreditoCuotas(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Fecha 1ra cuota</label>
                    <input type="date" value={creditoFecha} onChange={(e) => setCreditoFecha(e.target.value)} />
                  </div>
                  {creditoPlataforma !== "Crédito propio" && (
                    <div className="field">
                      <label>% comisión {creditoPlataforma} (uso interno)</label>
                      <input type="number" value={creditoComisionPct} onChange={(e) => setCreditoComisionPct(e.target.value)} placeholder="0" />
                    </div>
                  )}
                </div>
                {creditoPlataforma !== "Crédito propio" && (
                  <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginBottom: 10 }}>
                    Esta comisión solo la ves tú en el seguimiento de Créditos — no se refleja en lo que le cobras al cliente.
                  </div>
                )}
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>Pago de la inicial</label>
                <PaymentSection value={pagoInicialCredito} onChange={setPagoInicialCredito} label="Monto de la inicial" />
                {(() => {
                  const inicialNum = Number(creditoInicial) || 0;
                  const collected = pagosNativeTotal(buildPagos(pagoInicialCredito), data.currency, data.tasaBCV);
                  const collectedReal = pagosNativeTotal(buildPagos(pagoInicialCredito), data.currency, data.tasaInterna);
                  const diff = inicialNum - collected;
                  const completo = diff <= 0.01;
                  const prodSeleccionado = data.products.find((p) => p.id === telProductId);
                  const faltaCliente = !cliente.nombre.trim();
                  const faltaEquipo = !prodSeleccionado;
                  return (
                    <div className="receipt-box">
                      <div className="receipt-row">
                        <span>Inicial a cobrar (a tasa BCV)</span>
                        <span style={{ fontWeight: 800 }}>{money(inicialNum)}</span>
                      </div>
                      <div className="receipt-row">
                        <span>Cobrado (a tasa BCV)</span>
                        <span style={{ fontWeight: 800 }}>{money(collected)}</span>
                      </div>
                      <div className="receipt-row receipt-muted">
                        <span>Valor real de lo cobrado (tasa interna)</span>
                        <span>{money(collectedReal)}</span>
                      </div>
                      <div className="receipt-divider" />
                      {inicialNum <= 0 ? (
                        <div className="receipt-status neutral">Sin inicial — se factura sin cobro ahora</div>
                      ) : completo && diff < -0.01 ? (
                        <div className="receipt-status success">Vuelto a entregar: {formatBothCurrencies(-diff, data.currency, data.tasaBCV)}</div>
                      ) : completo ? (
                        <div className="receipt-status success">Cobro completo ✓</div>
                      ) : (
                        <div className="receipt-status danger">
                          Falta por cobrar: {money(diff)}
                          <div style={{ fontSize: 11, fontWeight: 700 }}>
                            Pide Bs. {convertNativeToBs(diff, data.currency, data.tasaBCV).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (tasa BCV — así se factura)
                          </div>
                          <div style={{ fontSize: 10.5, fontWeight: 500 }}>
                            Esos Bs. equivalen a ${pagoToUSD(convertNativeToBs(diff, data.currency, data.tasaBCV), "Efectivo", data.tasaInterna).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reales a tasa interna
                          </div>
                        </div>
                      )}
                      {(faltaCliente || faltaEquipo) && (
                        <div style={{ fontSize: 11.5, color: "var(--color-danger)", fontWeight: 700, marginTop: 8 }}>
                          Falta: {[faltaCliente && "datos del cliente (arriba)", faltaEquipo && "seleccionar el equipo"].filter(Boolean).join(" y ")}
                        </div>
                      )}
                      <button
                        className="btn btn-primary"
                        style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                        disabled={(inicialNum > 0 && !completo) || faltaCliente || faltaEquipo}
                        onClick={submitTelCredito}
                      >
                        <Check size={14} /> Facturar venta a crédito
                      </button>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>

      {carritoFactura.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <ClipboardList size={16} /> 3. Factura de {cliente.nombre || "este cliente"} ({carritoFactura.length} ítem
            {carritoFactura.length !== 1 ? "s" : ""})
          </div>
          {carritoFactura.map((it) => (
            <div className="cart-row" key={it.key}>
              <span style={{ flex: 1 }}>
                <Badge tone="neutral">{it.tipo}</Badge> {it.descripcion}
              </span>
              <span style={{ fontWeight: 700 }}>{money(it.montoCliente)}</span>
              <button className="icon-btn" onClick={() => quitarDelCarrito(it.key)}>
                <X size={14} />
              </button>
            </div>
          ))}

          <div className="field" style={{ marginTop: 10, maxWidth: 260 }}>
            <label>Descuento (opcional)</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="number"
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
                placeholder="0.00"
              />
              <MonedaToggle value={descuentoMoneda} onChange={setDescuentoMoneda} />
            </div>
            {descuentoValor > 0.005 && (
              <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 4 }}>
                Se descuenta {money(descuentoValor)} del total — nuevo total {money(totalCarrito)}
              </div>
            )}
          </div>

          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", marginTop: 10, display: "block" }}>
            Pago del cliente por toda la factura
          </label>
          <PaymentSection value={pagoFactura} onChange={setPagoFactura} label={esCasheaFactura ? "Inicial que paga el cliente" : "Monto cobrado"} />

          {esCasheaFactura ? (
            <div className="receipt-box">
              {descuentoValor > 0.005 && (
                <>
                  <div className="receipt-row receipt-muted">
                    <span>Subtotal</span>
                    <span>{money(totalCarritoBruto)}</span>
                  </div>
                  <div className="receipt-row receipt-muted">
                    <span>Descuento</span>
                    <span>− {money(descuentoValor)}</span>
                  </div>
                </>
              )}
              <div className="receipt-row">
                <span>Total de la factura (a tasa BCV)</span>
                <span style={{ fontWeight: 800 }}>{money(totalCarrito)}</span>
              </div>
              <div className="receipt-row">
                <span>Inicial que paga el cliente</span>
                <span style={{ fontWeight: 800 }}>{money(inicialCashea)}</span>
              </div>
              <div className="receipt-divider" />
              <div className="receipt-row">
                <span>Cashea financia</span>
                <span style={{ fontWeight: 800 }}>{money(financiadoCashea)}</span>
              </div>
              <div className="receipt-row receipt-muted">
                <span>Comisión Cashea ({CASHEA_GENERAL_COMISION_PCT}%)</span>
                <span>− {money(financiadoCashea - montoFinanciadoNetoCashea)}</span>
              </div>
              <div className="receipt-row">
                <span>Cashea te acreditará (neto)</span>
                <span style={{ fontWeight: 800, color: "var(--color-success)" }}>{money(montoFinanciadoNetoCashea)}</span>
              </div>
              <div className="receipt-divider" />
              <div className="receipt-status success">Cobro completo ✓ — el resto queda pendiente de Cashea (revisa Créditos)</div>
              <button
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                disabled={!facturaCompleta || !cliente.nombre.trim()}
                onClick={facturarCarrito}
              >
                <Check size={14} /> Facturar todo
              </button>
            </div>
          ) : (
            <div className="receipt-box">
              {descuentoValor > 0.005 && (
                <>
                  <div className="receipt-row receipt-muted">
                    <span>Subtotal</span>
                    <span>{money(totalCarritoBruto)}</span>
                  </div>
                  <div className="receipt-row receipt-muted">
                    <span>Descuento</span>
                    <span>− {money(descuentoValor)}</span>
                  </div>
                </>
              )}
              <div className="receipt-row">
                <span>Total de la factura (a tasa BCV)</span>
                <span style={{ fontWeight: 800 }}>{money(totalCarrito)}</span>
              </div>
              <div className="receipt-row">
                <span>Cobrado{bateriaShareFactura > 0 ? "" : " (a tasa BCV)"}</span>
                <span style={{ fontWeight: 800 }}>{money(cobradoFactura)}</span>
              </div>
              {bateriaShareFactura > 0 && (
                <div className="receipt-row receipt-muted">
                  <span>↳ baterías cobradas a tasa interna</span>
                  <span>{Math.round(bateriaShareFactura * 100)}% de la factura</span>
                </div>
              )}
              <div className="receipt-row receipt-muted">
                <span>Valor real de lo cobrado (tasa interna)</span>
                <span>{money(cobradoFacturaReal)}</span>
              </div>
              <div className="receipt-divider" />
              {facturaCompleta && diffFactura < -0.01 ? (
                <div className="receipt-status success">Vuelto a entregar: {formatBothCurrencies(-diffFactura, data.currency, data.tasaBCV)}</div>
              ) : facturaCompleta ? (
                <div className="receipt-status success">Cobro completo ✓</div>
              ) : (
                <div className="receipt-status danger">
                  Falta por cobrar: {money(diffFactura)}
                  <div style={{ fontSize: 11, fontWeight: 700 }}>
                    Pide Bs. {diffFacturaBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {bateriaShareFactura > 0 ? "(incluye baterías a tasa interna)" : "(tasa BCV — así se factura)"}
                  </div>
                  {bateriaShareFactura === 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 500 }}>
                      Esos Bs. equivalen a ${pagoToUSD(convertNativeToBs(diffFactura, data.currency, data.tasaBCV), "Efectivo", data.tasaInterna).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reales a tasa interna
                    </div>
                  )}
                </div>
              )}
              <button
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                disabled={!facturaCompleta || !cliente.nombre.trim()}
                onClick={facturarCarrito}
              >
                <Check size={14} /> Facturar todo
              </button>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={finalizarFactura} style={{ marginTop: 8 }}>
            Vaciar carrito / nuevo cliente
          </button>
        </div>
      )}
      </>
      )}

      <div className="panel">
        <div className="panel-title" style={{ cursor: "pointer" }} onClick={() => setHistory((h) => !h)}>
          <ShoppingCart size={16} /> Historial de ventas ({ventasHistorial.length}) {history ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
        {history &&
          (ventasHistorial.length === 0 ? (
            <div className="empty-state">Aún no has facturado ninguna venta.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Ganancia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ventasHistorial.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDate(s.fecha)}</td>
                    <td>{s.clienteNombre}</td>
                    <td>
                      <Badge tone="neutral">{s.tipo}</Badge>
                    </td>
                    <td style={{ fontWeight: 700, color: s.ganancia >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>{money(s.ganancia)}</td>
                    <td>
                      {confirmarEliminarId === s.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                          <span style={{ fontSize: 11, color: "var(--color-danger)", fontWeight: 700 }}>¿Eliminar?</span>
                          <button
                            onClick={() => eliminarVenta(s)}
                            style={{ background: "var(--color-danger)", color: "#fff", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                          >
                            Sí
                          </button>
                          <button
                            onClick={() => setConfirmarEliminarId(null)}
                            style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmarEliminarId(s.id)}
                          title="Eliminar venta"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-danger)", padding: 4, display: "flex" }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </>
  );
}

// ==================== CAJA ====================
function Caja({ data, setData, money }) {
  const fechasPendientesCierre = getFechasPendientesCierre(data);
  const [fecha, setFecha] = useState(() => (fechasPendientesCierre.length > 0 ? fechasPendientesCierre[0] : todayISO()));

  const ventasDelDia = data.sales.filter((s) => s.fecha === fecha && s.tipo !== "Financiamiento Cashea");
  const cierreExistente = data.cierresCaja.find((c) => c.fecha === fecha);

  const montoDeVenta = (s) => pagosNativeTotal(s.pagos || [], data.currency, data.tasaInterna);

  const totalDia = ventasDelDia.reduce((s, v) => s + montoDeVenta(v), 0);

  const porMetodo = {};
  ventasDelDia.forEach((v) => {
    (v.pagos || []).forEach((p) => {
      porMetodo[p.metodo] = (porMetodo[p.metodo] || 0) + (Number(p.monto) || 0);
    });
  });

  const cerrarCaja = () => {
    const resumen = {
      id: cierreExistente ? cierreExistente.id : uid(),
      fecha,
      totalVentas: ventasDelDia.length,
      totalDia,
      porMetodo,
      cerradoEn: new Date().toISOString(),
    };
    setData((d) => ({
      ...d,
      cierresCaja: cierreExistente ? d.cierresCaja.map((c) => (c.fecha === fecha ? resumen : c)) : [resumen, ...d.cierresCaja],
    }));
  };

  const historial = [...data.cierresCaja].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  return (
    <>
      {fechasPendientesCierre.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--color-danger, #dc2626)" }}>
          <div className="panel-title">
            <Lock size={16} /> Tienes {fechasPendientesCierre.length === 1 ? "un día" : `${fechasPendientesCierre.length} días`} sin cerrar
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 10 }}>
            No se pueden registrar nuevas ventas hasta cerrar la caja de:
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {fechasPendientesCierre.map((f) => (
              <button key={f} className={`btn btn-sm ${fecha === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFecha(f)}>
                {fmtDate(f)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="panel">
        <div className="panel-title">
          <Calculator size={16} /> Caja del día
        </div>
        <div className="form-grid" style={{ maxWidth: 240 }}>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
        {cierreExistente && (
          <Badge tone="success">Caja ya cerrada el {fmtDate(fecha)} · {new Date(cierreExistente.cerradoEn).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}</Badge>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">
          <Calculator size={16} /> Cuadre de caja
        </div>
        <div className="stat-grid">
          <Card icon={ShoppingCart} tone="primary" label="Ventas del día" value={ventasDelDia.length} sub={`Total: ${money(totalDia)}`} />
          {Object.entries(porMetodo).map(([metodo, monto]) => (
            <Card key={metodo} icon={CreditCard} tone="primary" label={metodo} value={fmtAccountAmount(monto, ACCOUNT_CURRENCY[METHOD_TO_ACCOUNT[metodo]])} sub="Cobrado hoy" />
          ))}
        </div>
        <button className="btn btn-primary" onClick={cerrarCaja}>
          <Check size={14} /> {cierreExistente ? "Actualizar cierre de caja" : "Cerrar caja del día"}
        </button>
      </div>

      <div className="panel">
        <div className="panel-title">
          <ShoppingCart size={16} /> Ventas del día ({ventasDelDia.length})
        </div>
        {ventasDelDia.length === 0 ? (
          <div className="empty-state">No hay ventas registradas en esta fecha.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo de venta</th>
                <th>Método(s) de pago</th>
                <th>Monto cobrado</th>
              </tr>
            </thead>
            <tbody>
              {ventasDelDia.map((v) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 700 }}>{v.clienteNombre}</td>
                  <td>
                    <Badge tone="neutral">{v.tipo}</Badge>
                  </td>
                  <td>{(v.pagos || []).map((p) => p.metodo).join(" + ") || "-"}</td>
                  <td style={{ fontWeight: 700 }}>{money(montoDeVenta(v))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {historial.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <CalendarClock size={16} /> Historial de cierres
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ventas</th>
                <th>Total del día</th>
                <th>Cerrado a las</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((c) => (
                <tr key={c.id}>
                  <td>{fmtDate(c.fecha)}</td>
                  <td>{c.totalVentas}</td>
                  <td style={{ fontWeight: 700 }}>{money(c.totalDia)}</td>
                  <td>{new Date(c.cerradoEn).toLocaleString("es-VE")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ==================== LISTA DE PRECIOS ====================
// Las baterías se separan de "Repuestos" con el mismo criterio (nombre contiene "batería") que se usa
// para el cobro a tasa interna en Ventas, así el vendedor ve agrupado igual que como se cobra.
const esBateriaProducto = (p) => p.categoria === "Repuestos" && /bateria|batería/i.test(p.nombre || "");

const PRICE_LIST_GROUPS = [
  { key: "telefono", label: "Teléfonos", emoji: "📱", match: (p) => p.categoria === "Teléfono" },
  { key: "bateria", label: "Baterías", emoji: "🔋", match: (p) => esBateriaProducto(p) },
  { key: "repuesto", label: "Repuestos", emoji: "🔧", match: (p) => p.categoria === "Repuestos" && !esBateriaProducto(p) },
  { key: "accesorio", label: "Accesorios", emoji: "🎧", match: (p) => p.categoria === "Accesorio" },
];

function ListaPrecios({ data, setData }) {
  const [copiado, setCopiado] = useState(false);
  const [modo, setModo] = useState("regular"); // "regular" | "cashea" | "chollo"
  const [editando, setEditando] = useState(false);

  const updatePrecioVenta = (id, value) =>
    setData((d) => ({ ...d, products: d.products.map((p) => (p.id === id ? { ...p, precioVenta: Number(value) || 0 } : p)) }));

  const fmtUSD = (n) => `$${(Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtBs = (n) => `Bs. ${(Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // El precio "$ a BCV" no es precioVenta*tasaBCV — es cuántos dólares representan, a tasa BCV, los
  // mismos bolívares que ese producto vale a tasa interna. Como tasa interna > tasa BCV, esos
  // bolívares valen más dólares al convertirlos con la tasa (más baja) del BCV.
  const precioBCV = (p) => (Number(p.precioVenta) * (Number(data.tasaInterna) || 0)) / (Number(data.tasaBCV) || 1);
  // Precio Cashea: precio a BCV + 7%, que es la comisión que cobra Cashea por su servicio de financiamiento.
  const precioCashea = (p) => precioBCV(p) * 1.07;
  // Precio Chollo: precio de venta normal en $ + un % ajustable (por defecto 17%), exclusivo de esta lista.
  const cholloPct = data.cholloPct != null ? Number(data.cholloPct) : 17;
  const precioChollo = (p) => Number(p.precioVenta) * (1 + cholloPct / 100);

  const grupos = PRICE_LIST_GROUPS.map((g) => ({
    ...g,
    productos: data.products.filter(g.match).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)),
  })).filter((g) => g.productos.length > 0);

  const construirTexto = () => {
    const lineas = [];
    if (modo === "cashea") {
      lineas.push("*LISTA DE PRECIOS CASHEA — PUNTO MOVISTAR*");
      lineas.push("Precio a BCV + 7% (comisión Cashea)");
      lineas.push(`Actualizado: ${fmtDate(todayISO())}`);
      lineas.push("");
      grupos.forEach((g) => {
        lineas.push(`${g.emoji} *${g.label.toUpperCase()}*`);
        g.productos.forEach((p) => {
          lineas.push(`• ${p.nombre}: ${fmtUSD(precioCashea(p))}`);
        });
        lineas.push("");
      });
      return lineas.join("\n").trim();
    }
    if (modo === "chollo") {
      lineas.push("*LISTA DE PRECIOS CHOLLO — PUNTO MOVISTAR*");
      lineas.push(`Precio de venta en $ + ${cholloPct}%`);
      lineas.push(`Actualizado: ${fmtDate(todayISO())}`);
      lineas.push("");
      grupos.forEach((g) => {
        lineas.push(`${g.emoji} *${g.label.toUpperCase()}*`);
        g.productos.forEach((p) => {
          lineas.push(`• ${p.nombre}: ${fmtUSD(precioChollo(p))}`);
        });
        lineas.push("");
      });
      return lineas.join("\n").trim();
    }
    lineas.push("*LISTA DE PRECIOS — PUNTO MOVISTAR*");
    lineas.push(`Tasa interna: ${data.tasaInterna} · Tasa BCV: ${data.tasaBCV}`);
    lineas.push(`Actualizado: ${fmtDate(todayISO())}`);
    lineas.push("");
    grupos.forEach((g) => {
      lineas.push(`${g.emoji} *${g.label.toUpperCase()}*`);
      g.productos.forEach((p) => {
        lineas.push(`• ${p.nombre}: ${fmtUSD(p.precioVenta)}  |  ${fmtBs(p.precioVenta * data.tasaInterna)} (interna)  |  ${fmtUSD(precioBCV(p))} (BCV)`);
      });
      lineas.push("");
    });
    return lineas.join("\n").trim();
  };

  const compartirWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(construirTexto())}`, "_blank");
  };

  // Se usa execCommand (en vez de solo navigator.clipboard.writeText, que en algunos navegadores
  // depende de un permiso async que puede quedar pendiente) porque es síncrono y funciona sin
  // pedir permiso, copiando desde un textarea temporal invisible.
  const copiarTexto = () => {
    const texto = construirTexto();
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      // Si el navegador tampoco soporta execCommand, al menos no rompemos la vista.
    }
    document.body.removeChild(ta);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <>
      <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", maxWidth: 480 }}>
          {modo === "cashea"
            ? "Lista de precios Cashea: precio a tasa BCV + 7%, que es la comisión que cobra Cashea por su servicio de financiamiento."
            : modo === "chollo"
            ? `Lista de precios Chollo: precio de venta en $ + ${cholloPct}%. Ajusta el porcentaje con el botón de la derecha; el cambio aplica solo a esta lista.`
            : editando
            ? "Modo edición: cambia el precio en $ de cualquier producto y presiona fuera del campo para guardarlo. Esto actualiza el precio de venta en tu Inventario, así que también se reflejará en Cashea, Chollo y en Ventas."
            : "Se arma sola desde tu Inventario: Teléfonos, Baterías, Repuestos y Accesorios, con su precio en $ a tasa interna, su equivalente en Bs. a tasa interna, y lo que esos mismos Bs. representan en $ si se calculan a tasa BCV."}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`btn btn-sm ${modo === "regular" ? "btn-primary" : "btn-ghost"}`} onClick={() => setModo("regular")}>
              Precio regular
            </button>
            <button
              className={`btn btn-sm ${modo === "cashea" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => {
                setModo("cashea");
                setEditando(false);
              }}
            >
              Precio Cashea
            </button>
            <button
              className={`btn btn-sm ${modo === "chollo" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => {
                setModo("chollo");
                setEditando(false);
              }}
            >
              Precio Chollo
            </button>
          </div>
          {modo === "regular" && (
            <button className={`btn btn-sm ${editando ? "btn-primary" : "btn-ghost"}`} onClick={() => setEditando((e) => !e)}>
              {editando ? <Check size={13} /> : <Tag size={13} />} {editando ? "Listo" : "Editar precios"}
            </button>
          )}
          {modo === "chollo" && (
            <TasaBadge label="% Chollo" value={cholloPct} onSave={(v) => setData((d) => ({ ...d, cholloPct: v }))} />
          )}
          <button className="btn btn-primary" onClick={compartirWhatsApp}>
            <Share2 size={14} /> Compartir por WhatsApp
          </button>
          <button className="btn" onClick={copiarTexto}>
            <Copy size={14} /> {copiado ? "¡Copiado!" : "Copiar lista"}
          </button>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="panel">
          <div className="empty-state">Aún no tienes productos de Teléfonos, Baterías, Repuestos o Accesorios en tu Inventario.</div>
        </div>
      ) : (
        grupos.map((g) => (
          <div className="panel" key={g.key}>
            <div className="panel-title">
              <Tag size={16} />
              {g.emoji} {g.label} ({g.productos.length})
            </div>
            <table>
              <thead>
                {modo === "cashea" ? (
                  <tr>
                    <th>Producto</th>
                    <th>Precio Cashea (BCV + 7%)</th>
                    <th>Stock</th>
                  </tr>
                ) : modo === "chollo" ? (
                  <tr>
                    <th>Producto</th>
                    <th>Precio Chollo ($ + {cholloPct}%)</th>
                    <th>Stock</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Producto</th>
                    <th>Precio $</th>
                    <th>Bs. (tasa interna)</th>
                    <th>$ a BCV</th>
                    <th>Stock</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {g.productos.map((p) =>
                  modo === "cashea" ? (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      <td style={{ fontWeight: 700 }}>{fmtUSD(precioCashea(p))}</td>
                      <td>{Number(p.stock) <= 5 ? <Badge tone="warning">{p.stock}</Badge> : <Badge tone="neutral">{p.stock}</Badge>}</td>
                    </tr>
                  ) : modo === "chollo" ? (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      <td style={{ fontWeight: 700 }}>{fmtUSD(precioChollo(p))}</td>
                      <td>{Number(p.stock) <= 5 ? <Badge tone="warning">{p.stock}</Badge> : <Badge tone="neutral">{p.stock}</Badge>}</td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      <td style={{ fontWeight: 700 }}>
                        {editando ? (
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={p.precioVenta}
                            onBlur={(e) => updatePrecioVenta(p.id, e.target.value)}
                            style={{ width: 90, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                          />
                        ) : (
                          fmtUSD(p.precioVenta)
                        )}
                      </td>
                      <td>{fmtBs(p.precioVenta * data.tasaInterna)}</td>
                      <td>{fmtUSD(precioBCV(p))}</td>
                      <td>{Number(p.stock) <= 5 ? <Badge tone="warning">{p.stock}</Badge> : <Badge tone="neutral">{p.stock}</Badge>}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        ))
      )}
    </>
  );
}

// ==================== INVENTARIO ====================
function Inventario({ data, setData, money }) {
  const [catFilter, setCatFilter] = useState("Todos");
  const [planForm, setPlanForm] = useState({ nombre: "", comisionBs: "" });
  const [cumplimiento, setCumplimiento] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({ nombre: "", categoria: CATEGORIES[0], costo: "", precioVenta: "", stock: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ nombre: "", categoria: CATEGORIES[0], costo: "", precioVenta: "", stock: "" });
  const [showTotalCosto, setShowTotalCosto] = useState(false);
  const [showStockBajo, setShowStockBajo] = useState(false);

  const totalCosto = data.products.reduce((s, p) => s + (Number(p.costo) || 0) * (Number(p.stock) || 0), 0);
  const stockBajo = data.products.filter((p) => Number(p.stock) <= 5).slice().sort((a, b) => Number(a.stock) - Number(b.stock));

  const removeProduct = (id) => setData((d) => ({ ...d, products: d.products.filter((p) => p.id !== id) }));
  const updatePrecioVenta = (id, value) =>
    setData((d) => ({ ...d, products: d.products.map((p) => (p.id === id ? { ...p, precioVenta: Number(value) || 0 } : p)) }));

  const startEditProduct = (p) => {
    setEditingId(p.id);
    setEditForm({
      nombre: p.nombre,
      categoria: p.categoria,
      costo: String(p.costo ?? ""),
      precioVenta: String(p.precioVenta ?? ""),
      stock: String(p.stock ?? ""),
    });
  };
  const cancelEditProduct = () => setEditingId(null);
  const saveEditProduct = () => {
    if (!editForm.nombre.trim()) return;
    setData((d) => ({
      ...d,
      products: d.products.map((p) =>
        p.id === editingId
          ? {
              ...p,
              nombre: editForm.nombre.trim(),
              categoria: editForm.categoria,
              costo: Number(editForm.costo) || 0,
              precioVenta: Number(editForm.precioVenta) || 0,
              stock: Number(editForm.stock) || 0,
            }
          : p
      ),
    }));
    setEditingId(null);
  };

  const addProductManual = () => {
    if (!newProduct.nombre.trim()) return;
    setData((d) => ({
      ...d,
      products: [
        {
          id: uid(),
          nombre: newProduct.nombre.trim(),
          categoria: newProduct.categoria,
          costo: Number(newProduct.costo) || 0,
          precioVenta: Number(newProduct.precioVenta) || 0,
          stock: Number(newProduct.stock) || 0,
        },
        ...d.products,
      ],
    }));
    setNewProduct({ nombre: "", categoria: newProduct.categoria, costo: "", precioVenta: "", stock: "" });
    setShowAddForm(false);
  };

  const addPlan = () => {
    if (!planForm.nombre.trim()) return;
    setData((d) => ({ ...d, planes: [{ id: uid(), nombre: planForm.nombre, comisionBs: Number(planForm.comisionBs) || 0 }, ...d.planes] }));
    setPlanForm({ nombre: "", comisionBs: "" });
  };
  const removePlan = (id) => setData((d) => ({ ...d, planes: d.planes.filter((p) => p.id !== id) }));

  const filtered = catFilter === "Todos" ? data.products : data.products.filter((p) => p.categoria === catFilter);

  return (
    <>
      <div className="panel">
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: showAddForm ? 14 : 0 }}>
          Los productos también se agregan automáticamente desde <strong>Órdenes de Compra</strong>, al registrar la factura donde llegaron. Usa
          el botón de abajo para ingresar mercancía existente manualmente (por ejemplo, tu inventario inicial).
        </div>
        {!showAddForm ? (
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            <Plus size={14} /> Agregar producto manualmente
          </button>
        ) : (
          <div>
            <div className="form-grid">
              <div className="field">
                <label>Nombre del producto</label>
                <input
                  value={newProduct.nombre}
                  onChange={(e) => setNewProduct((f) => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej. Cargador tipo C"
                />
              </div>
              <div className="field">
                <label>Categoría</label>
                <select value={newProduct.categoria} onChange={(e) => setNewProduct((f) => ({ ...f, categoria: e.target.value }))}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Costo</label>
                <input
                  type="number"
                  value={newProduct.costo}
                  onChange={(e) => setNewProduct((f) => ({ ...f, costo: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="field">
                <label>Precio de venta</label>
                <input
                  type="number"
                  value={newProduct.precioVenta}
                  onChange={(e) => setNewProduct((f) => ({ ...f, precioVenta: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="field">
                <label>Stock inicial</label>
                <input
                  type="number"
                  min={0}
                  value={newProduct.stock}
                  onChange={(e) => setNewProduct((f) => ({ ...f, stock: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={!newProduct.nombre.trim()} onClick={addProductManual}>
                <Check size={14} /> Guardar producto
              </button>
              <button className="btn btn-ghost" onClick={() => setShowAddForm(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={() => setShowTotalCosto((s) => !s)}>
            <Wallet size={14} /> {showTotalCosto ? "Ocultar" : "Ver"} valor total en costo
          </button>
          <button className="btn btn-ghost" onClick={() => setShowStockBajo((s) => !s)}>
            <AlertTriangle size={14} /> Stock bajo ({stockBajo.length})
          </button>
        </div>
        {showTotalCosto && (
          <div className="stat-grid" style={{ marginTop: 14 }}>
            <Card
              icon={Wallet}
              tone="primary"
              label="Valor total en costo del inventario"
              value={money(totalCosto)}
              sub={`${data.products.length} productos en stock`}
            />
          </div>
        )}
        {showStockBajo && (
          <div style={{ marginTop: 14 }}>
            {stockBajo.length === 0 ? (
              <div className="empty-state">No hay productos con stock bajo. Todo en orden.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {stockBajo.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>{p.nombre}</td>
                      <td>
                        <Badge tone="neutral">{p.categoria}</Badge>
                      </td>
                      <td>
                        <Badge tone="warning">{p.stock}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">
          <Boxes size={16} /> Inventario ({filtered.length})
        </div>
        <div className="cat-tabs">
          {["Todos", ...CATEGORIES].map((c) => (
            <button key={c} className={`cat-tab ${catFilter === c ? "active" : ""}`} onClick={() => setCatFilter(c)}>
              {c}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">No hay productos en esta categoría todavía.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Costo</th>
                <th>Precio</th>
                <th>% Utilidad</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const pct = marginPct(p.costo, p.precioVenta);
                const isEditing = editingId === p.id;
                if (isEditing) {
                  return (
                    <tr key={p.id} style={{ background: "#E7F0FC" }}>
                      <td>
                        <input
                          value={editForm.nombre}
                          onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))}
                          style={{ width: "100%", minWidth: 110, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                        />
                      </td>
                      <td>
                        <select
                          value={editForm.categoria}
                          onChange={(e) => setEditForm((f) => ({ ...f, categoria: e.target.value }))}
                          style={{ padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          value={editForm.costo}
                          onChange={(e) => setEditForm((f) => ({ ...f, costo: e.target.value }))}
                          style={{ width: 75, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={editForm.precioVenta}
                          onChange={(e) => setEditForm((f) => ({ ...f, precioVenta: e.target.value }))}
                          style={{ width: 80, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                        />
                      </td>
                      <td>
                        <Badge tone={marginTone(pct)}>{pct.toFixed(1)}%</Badge>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={editForm.stock}
                          onChange={(e) => setEditForm((f) => ({ ...f, stock: e.target.value }))}
                          style={{ width: 65, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="link-btn" style={{ color: "var(--color-success)" }} disabled={!editForm.nombre.trim()} onClick={saveEditProduct}>
                            Guardar
                          </button>
                          <button className="link-btn" style={{ color: "var(--color-text-muted)" }} onClick={cancelEditProduct}>
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{p.nombre}</td>
                    <td>
                      <Badge tone="neutral">{p.categoria}</Badge>
                    </td>
                    <td>{money(p.costo)}</td>
                    <td>
                      <input
                        type="number"
                        defaultValue={p.precioVenta}
                        onBlur={(e) => updatePrecioVenta(p.id, e.target.value)}
                        style={{ width: 80, padding: "5px 7px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 12.5 }}
                      />
                    </td>
                    <td>
                      <Badge tone={marginTone(pct)}>{pct.toFixed(1)}%</Badge>
                    </td>
                    <td>
                      {Number(p.stock) <= 5 ? <Badge tone="warning">{p.stock} bajo</Badge> : <Badge tone="neutral">{p.stock}</Badge>}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="link-btn" style={{ color: "var(--color-primary)" }} onClick={() => startEditProduct(p)}>
                          Editar
                        </button>
                        <button className="link-btn" onClick={() => removeProduct(p.id)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">
          <Receipt size={16} /> Referencia: plan de incentivo mensual Movistar
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
          Bono adicional sobre la comisión según el % de la meta comercial mensual alcanzada. El 60% de las activaciones se
          adelanta a inicio de mes y el resto se liquida al cierre.
        </div>
        <div className="form-grid" style={{ maxWidth: 240 }}>
          <div className="field">
            <label>% de la meta alcanzado este mes</label>
            <input type="number" value={cumplimiento} onChange={(e) => setCumplimiento(e.target.value)} placeholder="ej. 108" />
          </div>
        </div>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Banda</th>
              <th>Rango</th>
              <th>Bono</th>
            </tr>
          </thead>
          <tbody>
            {INCENTIVO_BANDAS.map((b) => {
              const activo = Number(cumplimiento) >= b.min && Number(cumplimiento) <= b.max;
              return (
                <tr key={b.banda} style={activo ? { background: "#E7F0FC" } : {}}>
                  <td>{b.banda}</td>
                  <td>
                    {b.min}% – {b.max === Infinity ? "en adelante" : `${b.max}%`}
                  </td>
                  <td>
                    <Badge tone={activo ? "success" : "neutral"}>{b.pct}%</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-title">
          <Wifi size={16} /> Catálogo de planes y comisiones Movistar
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 14 }}>
          Movistar paga sus comisiones en bolívares. El sistema las convierte automáticamente usando la <strong>Tasa BCV</strong> configurada
          arriba, a la moneda que tengas seleccionada.
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Nombre del plan</label>
            <input value={planForm.nombre} onChange={(e) => setPlanForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Pospago - 10 GB" />
          </div>
          <div className="field">
            <label>Comisión Movistar (Bs.)</label>
            <input type="number" value={planForm.comisionBs} onChange={(e) => setPlanForm((f) => ({ ...f, comisionBs: e.target.value }))} placeholder="0.00" />
          </div>
        </div>
        <button className="btn btn-primary" onClick={addPlan}>
          <Check size={14} /> Agregar plan
        </button>
        {data.planes.length > 0 && (
          <table style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Comisión Bs.</th>
                <th>Equivalente en {data.currency === "USD" ? "USD" : "Bs."}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.planes.map((p) => (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td>Bs. {(Number(p.comisionBs) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2 })}</td>
                  <td style={{ fontWeight: 700 }}>{money(convertBs(p.comisionBs, data.currency, data.tasaBCV))}</td>
                  <td>
                    <button className="link-btn" onClick={() => removePlan(p.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8 }}>
          Cuando factures una línea nueva en la pestaña Ventas, eliges el plan aquí registrado y la comisión se auto-completa (editable por si Movistar da una promoción puntual). Estos montos son los que Movistar publica en bolívares (Bs.) — si tienes el resto del negocio en USD, cambia el interruptor de moneda arriba a "Bs." antes de revisar tus comisiones para que no se mezclen los símbolos.
        </div>
      </div>
    </>
  );
}

// ==================== CREDITOS ====================
function creditStatus(credit) {
  const today = todayISO();
  const pendientes = credit.cuotas.filter((q) => !q.pagado);
  if (pendientes.length === 0) return { label: "Pagado", tone: "success" };
  const vencida = pendientes.find((q) => daysBetween(q.fechaVencimiento, today) > 0);
  if (vencida) return { label: "En mora", tone: "danger" };
  const proxima = pendientes[0];
  if (proxima && daysBetween(today, proxima.fechaVencimiento) <= 5) return { label: "Próxima a vencer", tone: "warning" };
  return { label: "Al día", tone: "primary" };
}

// ==================== ORDENES DE COMPRA ====================
function Compras({ data, setData, money, walletBalances }) {
  const [numeroFactura, setNumeroFactura] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState(todayISO());
  const [pagoFactura, setPagoFactura] = useState(paymentDefault());
  const [expanded, setExpanded] = useState(null);

  // Line-item entry sub-form
  const [modo, setModo] = useState("existente"); // 'existente' | 'nuevo'
  const [productId, setProductId] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaCategoria, setNuevaCategoria] = useState(CATEGORIES[0]);
  const [nuevoPrecioVenta, setNuevoPrecioVenta] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [items, setItems] = useState([]);

  const prodSeleccionado = data.products.find((p) => p.id === productId);
  const costoAnteriorPreview = modo === "existente" && prodSeleccionado ? Number(prodSeleccionado.costo) || 0 : null;
  const costoNuevoPreview = Number(costoUnitario) || 0;
  const cambioCostoPreview =
    modo === "existente" && prodSeleccionado && costoUnitario !== "" ? costoNuevoPreview - costoAnteriorPreview : null;

  const addItem = () => {
    const cant = Number(cantidad);
    const costo = Number(costoUnitario);
    if (!(cant > 0) || !(costo >= 0)) return;
    if (modo === "existente") {
      if (!prodSeleccionado) return;
      setItems((its) => [
        ...its,
        {
          key: uid(),
          productId: prodSeleccionado.id,
          nombre: prodSeleccionado.nombre,
          categoria: prodSeleccionado.categoria,
          cantidad: cant,
          costoUnitario: costo,
          costoAnterior: Number(prodSeleccionado.costo) || 0,
          esNuevo: false,
        },
      ]);
    } else {
      if (!nuevoNombre.trim()) return;
      setItems((its) => [
        ...its,
        {
          key: uid(),
          productId: null,
          nombre: nuevoNombre,
          categoria: nuevaCategoria,
          cantidad: cant,
          costoUnitario: costo,
          costoAnterior: null,
          esNuevo: true,
          precioVenta: Number(nuevoPrecioVenta) || 0,
        },
      ]);
    }
    setProductId("");
    setNuevoNombre("");
    setNuevoPrecioVenta("");
    setCantidad("");
    setCostoUnitario("");
  };

  const removeItem = (key) => setItems((its) => its.filter((it) => it.key !== key));

  const montoTotalOrden = items.reduce((s, it) => s + it.cantidad * it.costoUnitario, 0);
  const pagosFactura = buildPagos(pagoFactura);
  const pagadoAhora = pagosNativeTotal(pagosFactura, data.currency, data.tasaInterna);
  const saldoPendientePreview = Math.max(0, montoTotalOrden - pagadoAhora);
  const excesos = excesosDeSaldo(pagosFactura, walletBalances);
  const puedeRegistrar = items.length > 0 && excesos.length === 0 && pagadoAhora <= montoTotalOrden + 0.01;

  const submitOrden = () => {
    if (!puedeRegistrar) return;
    const orden = {
      id: uid(),
      fecha: todayISO(),
      numeroFactura,
      proveedor,
      items: items.map((it) => ({
        nombre: it.nombre,
        categoria: it.categoria,
        cantidad: it.cantidad,
        costoUnitario: it.costoUnitario,
        costoAnterior: it.costoAnterior,
        esNuevo: it.esNuevo,
      })),
      montoTotal: montoTotalOrden,
      pagos: pagosFactura.map((p) => ({ ...p, fecha: todayISO() })),
      fechaVencimiento: saldoPendientePreview > 0.01 ? fechaVencimiento : null,
    };

    setData((d) => {
      let products = d.products;
      items.forEach((it) => {
        if (it.esNuevo) {
          products = [
            { id: uid(), nombre: it.nombre, categoria: it.categoria, costo: it.costoUnitario, precioVenta: it.precioVenta, stock: it.cantidad },
            ...products,
          ];
        } else {
          products = products.map((p) => (p.id === it.productId ? { ...p, stock: Number(p.stock) + it.cantidad, costo: it.costoUnitario } : p));
        }
      });
      return { ...d, products, ordenesCompra: [orden, ...d.ordenesCompra] };
    });

    setItems([]);
    setProveedor("");
    setNumeroFactura("");
    setPagoFactura(paymentDefault());
    setFechaVencimiento(todayISO());
  };

  const ordenesConSaldo = data.ordenesCompra.map((o) => ({
    ...o,
    saldoPendiente: Math.max(0, (Number(o.montoTotal) || 0) - pagosNativeTotal(o.pagos || [], data.currency, data.tasaInterna)),
  }));

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <Plus size={16} /> Nueva factura de compra
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Nº de factura</label>
            <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="00012345" />
          </div>
          <div className="field">
            <label>Proveedor</label>
            <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Nombre del proveedor" />
          </div>
        </div>

        <div className="subtype-toggle" style={{ marginBottom: 12, maxWidth: 320 }}>
          <button className={modo === "existente" ? "selected" : ""} onClick={() => setModo("existente")}>
            Producto existente
          </button>
          <button className={modo === "nuevo" ? "selected" : ""} onClick={() => setModo("nuevo")}>
            Producto nuevo
          </button>
        </div>

        {modo === "existente" ? (
          <div className="form-grid">
            <div className="field">
              <label>Producto</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Seleccionar producto...</option>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.categoria}] {p.nombre} (costo actual {money(p.costo)} · stock {p.stock})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cantidad</label>
              <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label>Costo unitario de esta factura</label>
              <input type="number" value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)} placeholder="0.00" />
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <div className="field">
              <label>Nombre del producto</label>
              <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="iPhone 13 128GB" />
            </div>
            <div className="field">
              <label>Categoría</label>
              <select value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cantidad</label>
              <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label>Costo unitario</label>
              <input type="number" value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)} placeholder="0.00" />
            </div>
            <div className="field">
              <label>Precio de venta</label>
              <input type="number" value={nuevoPrecioVenta} onChange={(e) => setNuevoPrecioVenta(e.target.value)} placeholder="0.00" />
            </div>
          </div>
        )}

        {cambioCostoPreview !== null && (
          <div style={{ fontSize: 12, marginBottom: 10 }}>
            Costo anterior: {money(costoAnteriorPreview)} → Nuevo: {money(costoNuevoPreview)}{" "}
            {cambioCostoPreview > 0.001 && <Badge tone="danger">subió {money(cambioCostoPreview)}</Badge>}
            {cambioCostoPreview < -0.001 && <Badge tone="success">bajó {money(-cambioCostoPreview)}</Badge>}
            {Math.abs(cambioCostoPreview) <= 0.001 && <Badge tone="neutral">sin cambio</Badge>}
          </div>
        )}

        <button className="btn btn-ghost btn-sm" onClick={addItem} style={{ marginBottom: 14 }}>
          <Plus size={13} /> Agregar producto a la factura
        </button>

        {items.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {items.map((it) => (
              <div className="cart-row" key={it.key}>
                <span style={{ flex: 1 }}>
                  {it.esNuevo && <Badge tone="primary">Nuevo</Badge>} {it.nombre} · {it.categoria} × {it.cantidad}
                </span>
                <span style={{ fontWeight: 700 }}>{money(it.cantidad * it.costoUnitario)}</span>
                <button className="icon-btn" onClick={() => removeItem(it.key)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>¿Cuánto pagas de esta factura ahora?</label>
        <PaymentSection value={pagoFactura} onChange={setPagoFactura} label="Monto pagado ahora" />

        {excesos.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {excesos.map((e, i) => (
              <div key={i} style={{ fontSize: 11.5, color: "var(--color-danger)", fontWeight: 700 }}>
                Saldo insuficiente en {e.cuenta}: disponible {fmtAccountAmount(e.disponible, ACCOUNT_CURRENCY[e.cuenta])}, intentas pagar{" "}
                {fmtAccountAmount(e.monto, ACCOUNT_CURRENCY[e.cuenta])}.
              </div>
            ))}
          </div>
        )}

        {saldoPendientePreview > 0.01 && (
          <div className="form-grid">
            <div className="field">
              <label>Fecha de vencimiento del saldo pendiente</label>
              <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />
            </div>
          </div>
        )}

        <div className="receipt-box">
          <div className="receipt-row">
            <span>Total de la factura</span>
            <span style={{ fontWeight: 800 }}>{money(montoTotalOrden)}</span>
          </div>
          <div className="receipt-row">
            <span>Pagado ahora</span>
            <span style={{ fontWeight: 800 }}>{money(pagadoAhora)}</span>
          </div>
          <div className="receipt-divider" />
          {montoTotalOrden === 0 ? (
            <div className="receipt-status neutral">Agrega productos a la factura</div>
          ) : saldoPendientePreview <= 0.01 ? (
            <div className="receipt-status success">Factura pagada completa ✓</div>
          ) : (
            <div className="receipt-status danger">Quedará pendiente en Cuentas por Pagar: {money(saldoPendientePreview)}</div>
          )}
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} disabled={!puedeRegistrar} onClick={submitOrden}>
            <Check size={14} /> Registrar factura de compra
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <ClipboardList size={16} /> Historial de compras ({data.ordenesCompra.length})
        </div>
        {ordenesConSaldo.length === 0 ? (
          <div className="empty-state">Aún no has registrado ninguna factura de compra.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Fecha</th>
                <th>Nº factura</th>
                <th>Proveedor</th>
                <th>Productos</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ordenesConSaldo.map((o) => {
                const isOpen = expanded === o.id;
                return (
                  <React.Fragment key={o.id}>
                    <tr>
                      <td>
                        <button className="row-expand-btn" onClick={() => setExpanded(isOpen ? null : o.id)}>
                          {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      </td>
                      <td>{fmtDate(o.fecha)}</td>
                      <td>{o.numeroFactura || "-"}</td>
                      <td>{o.proveedor || "-"}</td>
                      <td>
                        <Badge tone="neutral">
                          {o.items.length} producto{o.items.length !== 1 ? "s" : ""}
                        </Badge>
                      </td>
                      <td style={{ fontWeight: 700 }}>{money(o.montoTotal)}</td>
                      <td>
                        {o.saldoPendiente <= 0.01 ? (
                          <Badge tone="success">Pagada</Badge>
                        ) : (
                          <Badge tone="warning">Pendiente {money(o.saldoPendiente)}</Badge>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ border: "none", padding: "0 10px 12px 10px" }}>
                          <div className="subtable-wrap">
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "var(--color-text-muted)" }}>
                              Detalle de la factura
                            </div>
                            {o.items.map((it, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                                <span>
                                  {it.esNuevo && <Badge tone="primary">Nuevo</Badge>} {it.nombre} · {it.categoria} × {it.cantidad}
                                  {!it.esNuevo && it.costoAnterior != null && (
                                    <span style={{ color: "var(--color-text-muted)" }}>
                                      {" "}
                                      (antes {money(it.costoAnterior)} → {money(it.costoUnitario)})
                                    </span>
                                  )}
                                </span>
                                <span style={{ fontWeight: 700 }}>{money(it.cantidad * it.costoUnitario)}</span>
                              </div>
                            ))}
                            {o.pagos && o.pagos.length > 0 && (
                              <>
                                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 8, marginBottom: 4, color: "var(--color-text-muted)" }}>
                                  Pagos realizados
                                </div>
                                {o.pagos.map((p, i) => (
                                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                                    <span>{p.metodo}</span>
                                    <span style={{ fontWeight: 700 }}>{fmtAccountAmount(p.monto, ACCOUNT_CURRENCY[METHOD_TO_ACCOUNT[p.metodo]])}</span>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ==================== CUENTAS POR PAGAR ====================
function CuentasPorPagar({ data, setData, money, walletBalances }) {
  const [expandedProveedor, setExpandedProveedor] = useState(null);
  const [abonoPago, setAbonoPago] = useState({});

  const fmtUSD = (n) => `$${(Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const ordenesConSaldo = data.ordenesCompra.map((o) => ({
    ...o,
    saldoPendiente: Math.max(0, (Number(o.montoTotal) || 0) - pagosNativeTotal(o.pagos || [], data.currency, data.tasaInterna)),
  }));

  // Group every purchase order (invoice) by supplier, so each company has its own running account.
  const porProveedor = {};
  ordenesConSaldo.forEach((o) => {
    const key = (o.proveedor || "").trim() || "Sin proveedor";
    if (!porProveedor[key]) porProveedor[key] = [];
    porProveedor[key].push(o);
  });

  const proveedores = Object.entries(porProveedor)
    .map(([nombre, facturas]) => {
      const saldoActual = facturas.reduce((s, f) => s + f.saldoPendiente, 0);
      const vencidas = facturas.filter((f) => f.saldoPendiente > 0.01 && f.fechaVencimiento && daysBetween(f.fechaVencimiento, todayISO()) > 0);

      // Build a chronological ledger: one row per invoice, one row per payment against it.
      // Each invoice's own row is pushed before its payments, and a sequence index keeps
      // that guarantee even when several movements share the same date.
      const movimientosAsc = [];
      let seq = 0;
      facturas.forEach((f) => {
        movimientosAsc.push({
          seq: seq++,
          fecha: f.fecha,
          descripcion: `Factura ${f.numeroFactura || "s/n"}`,
          montoFacturaUSD: nativeToUSD(f.montoTotal, data.currency, data.tasaInterna),
          montoAbonoUSD: null,
        });
        (f.pagos || []).forEach((p) => {
          movimientosAsc.push({
            seq: seq++,
            fecha: p.fecha || f.fecha,
            descripcion: `Abono factura ${f.numeroFactura || "s/n"} (${p.metodo})`,
            montoFacturaUSD: null,
            montoAbonoUSD: pagoToUSD(p.monto, p.metodo, data.tasaInterna),
          });
        });
      });
      movimientosAsc.sort((a, b) => {
        const cmp = (a.fecha || "").localeCompare(b.fecha || "");
        return cmp !== 0 ? cmp : a.seq - b.seq;
      });
      let saldoCorrido = 0;
      const movimientos = movimientosAsc.map((m) => {
        saldoCorrido += (m.montoFacturaUSD || 0) - (m.montoAbonoUSD || 0);
        return { ...m, saldoUSD: saldoCorrido };
      });

      const facturasOrdenadas = [...facturas].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
      const facturasPendientesAsc = facturas.filter((f) => f.saldoPendiente > 0.01).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
      return { nombre, facturasOrdenadas, facturasPendientesAsc, movimientos, saldoActual, vencidas: vencidas.length };
    })
    .sort((a, b) => b.saldoActual - a.saldoActual);

  const totalPorPagar = proveedores.reduce((s, p) => s + p.saldoActual, 0);
  const totalVencidas = proveedores.reduce((s, p) => s + p.vencidas, 0);

  const getAbono = (nombre) => abonoPago[nombre] || [{ metodo: PAYMENT_METHODS[0], monto: "" }];
  const setAbono = (nombre, rows) => setAbonoPago((s) => ({ ...s, [nombre]: rows }));
  const abonoPagos = (nombre) =>
    getAbono(nombre)
      .filter((r) => Number(r.monto) > 0)
      .map((r) => ({ metodo: r.metodo, monto: Number(r.monto) || 0 }));

  const pagarAbono = (prov) => {
    const pagos = abonoPagos(prov.nombre);
    const excesos = excesosDeSaldo(pagos, walletBalances);
    if (excesos.length > 0) return;
    const montoAbono = pagosNativeTotal(pagos, data.currency, data.tasaInterna);
    if (montoAbono <= 0 || montoAbono > prov.saldoActual + 0.01) return;
    const asignaciones = distribuirAbonoFIFO(prov.facturasPendientesAsc, pagos, data.currency, data.tasaInterna);
    setData((d) => ({
      ...d,
      ordenesCompra: d.ordenesCompra.map((o) => (asignaciones[o.id] ? { ...o, pagos: [...(o.pagos || []), ...asignaciones[o.id]] } : o)),
    }));
    setAbonoPago((s) => ({ ...s, [prov.nombre]: [{ metodo: PAYMENT_METHODS[0], monto: "" }] }));
  };

  return (
    <>
      <div className="stat-grid">
        <Card icon={ClipboardList} tone={totalPorPagar > 0 ? "warning" : "success"} label="Total por pagar a proveedores" value={fmtUSD(totalPorPagar)} sub={`${proveedores.length} empresa${proveedores.length !== 1 ? "s" : ""}`} />
        <Card icon={AlertTriangle} tone={totalVencidas ? "danger" : "success"} label="Facturas vencidas" value={totalVencidas} sub={totalVencidas ? "Requieren atención" : "Todo al día"} />
      </div>

      {proveedores.length === 0 ? (
        <div className="panel">
          <div className="empty-state">No tienes facturas de compra registradas todavía.</div>
        </div>
      ) : (
        proveedores.map((prov) => {
          const isOpen = expandedProveedor === prov.nombre;
          const rows = getAbono(prov.nombre);
          const pagosAbono = abonoPagos(prov.nombre);
          const excesos = excesosDeSaldo(pagosAbono, walletBalances);
          const montoAbono = pagosNativeTotal(pagosAbono, data.currency, data.tasaInterna);
          return (
            <div className="panel" key={prov.nombre}>
              <div
                className="panel-title"
                style={{ cursor: "pointer", justifyContent: "space-between", display: "flex", alignItems: "center" }}
                onClick={() => setExpandedProveedor(isOpen ? null : prov.nombre)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ClipboardList size={16} /> {prov.nombre}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge tone={prov.saldoActual > 0.01 ? "danger" : "success"}>
                    {prov.saldoActual > 0.01 ? `Debe ${fmtUSD(prov.saldoActual)}` : "Al día"}
                  </Badge>
                  {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </span>
              </div>

              {isOpen && (
                <div>
                  <table style={{ marginBottom: 16 }}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Descripción</th>
                        <th>Factura</th>
                        <th>Abono ($$)</th>
                        <th>Saldo de la deuda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prov.movimientos.map((m, i) => (
                        <tr key={i}>
                          <td>{fmtDate(m.fecha)}</td>
                          <td>{m.descripcion}</td>
                          <td>{m.montoFacturaUSD != null ? fmtUSD(m.montoFacturaUSD) : "-"}</td>
                          <td style={{ color: "var(--color-success)", fontWeight: m.montoAbonoUSD != null ? 700 : 400 }}>
                            {m.montoAbonoUSD != null ? fmtUSD(m.montoAbonoUSD) : "-"}
                          </td>
                          <td style={{ fontWeight: 800 }}>{fmtUSD(m.saldoUSD)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {prov.saldoActual > 0.01 && (
                    <div className="subtable-wrap">
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Registrar abono a esta cuenta</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
                        Se aplica automáticamente a la factura más antigua pendiente primero, y así sucesivamente. Saldo total de la cuenta:{" "}
                        {fmtUSD(prov.saldoActual)}.
                      </div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)" }}>
                        Puedes combinar varias monedas o métodos
                      </label>
                      <AbonoMultiMetodo rows={rows} onChange={(v) => setAbono(prov.nombre, v)} />
                      <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginBottom: 8 }}>Total a abonar: {money(montoAbono)}</div>
                      {excesos.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          {excesos.map((e, i) => (
                            <div key={i} style={{ fontSize: 11.5, color: "var(--color-danger)", fontWeight: 700 }}>
                              Saldo insuficiente en {e.cuenta}: disponible {fmtAccountAmount(e.disponible, ACCOUNT_CURRENCY[e.cuenta])}.
                            </div>
                          ))}
                        </div>
                      )}
                      {montoAbono > prov.saldoActual + 0.01 && (
                        <div style={{ fontSize: 11.5, color: "var(--color-danger)", fontWeight: 700, marginBottom: 8 }}>
                          El monto a abonar no puede superar el saldo total de la cuenta ({fmtUSD(prov.saldoActual)}).
                        </div>
                      )}
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={excesos.length > 0 || montoAbono <= 0 || montoAbono > prov.saldoActual + 0.01}
                        onClick={() => pagarAbono(prov)}
                      >
                        <Check size={13} /> Registrar abono
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

function Creditos({ data, setData, money }) {
  const [expanded, setExpanded] = useState(null);

  const toggleCuota = (creditId, numero) => {
    setData((d) => ({
      ...d,
      credits: d.credits.map((c) => {
        if (c.id !== creditId) return c;
        return {
          ...c,
          cuotas: c.cuotas.map((q) => (q.numero === numero ? { ...q, pagado: !q.pagado, fechaPago: !q.pagado ? todayISO() : null } : q)),
        };
      }),
    }));
  };

  const remove = (id) => setData((d) => ({ ...d, credits: d.credits.filter((c) => c.id !== id) }));

  const marcarLiquidado = (saleId) => {
    setData((d) => ({
      ...d,
      sales: d.sales.map((s) => (s.id === saleId ? { ...s, liquidado: true, fechaLiquidacion: todayISO() } : s)),
    }));
  };

  const marcarTodoLiquidado = (plataforma) => {
    setData((d) => ({
      ...d,
      sales: d.sales.map((s) =>
        (s.tipo === "Teléfono Crédito" || s.tipo === "Financiamiento Cashea") && s.plataforma === plataforma && !s.liquidado
          ? { ...s, liquidado: true, fechaLiquidacion: todayISO() }
          : s
      ),
    }));
  };

  const ventasCredito = data.sales.filter(
    (s) => (s.tipo === "Teléfono Crédito" || s.tipo === "Financiamiento Cashea") && s.plataforma && s.plataforma !== "Crédito propio"
  );
  const porPlataforma = {};
  ventasCredito.forEach((s) => {
    if (!porPlataforma[s.plataforma]) porPlataforma[s.plataforma] = { pendiente: 0, recibido: 0 };
    if (s.liquidado) porPlataforma[s.plataforma].recibido += Number(s.montoFinanciadoNeto) || 0;
    else porPlataforma[s.plataforma].pendiente += Number(s.montoFinanciadoNeto) || 0;
  });
  const pendientesPorPlataforma = {};
  ventasCredito
    .filter((s) => !s.liquidado)
    .forEach((s) => {
      if (!pendientesPorPlataforma[s.plataforma]) pendientesPorPlataforma[s.plataforma] = [];
      pendientesPorPlataforma[s.plataforma].push(s);
    });

  return (
    <div className="panel">
      <div className="panel-title">
        <Smartphone size={16} /> Créditos ({data.credits.length})
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginBottom: 12 }}>
        Los créditos se crean automáticamente al facturar una venta de teléfono a crédito, o cualquier factura pagada con
        Cashea (línea nueva, cambio de línea, accesorios o repuestos), en la pestaña Ventas. Cashea y Chollo suelen pagarte
        el monto financiado (neto de su comisión) alrededor de una semana después de la venta — hasta que lo marques como
        recibido, se muestra como acumulado pendiente y no entra a tu Billetera.
      </div>
      {Object.keys(porPlataforma).length > 0 && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          {Object.entries(porPlataforma).map(([plat, montos]) => (
            <React.Fragment key={plat}>
              <Card icon={RefreshCw} tone={montos.pendiente > 0 ? "warning" : "success"} label={`Pendiente de ${plat} (facturado)`} value={money(montos.pendiente)} sub="Aún no acreditado a tu Billetera" />
              <Card icon={Wallet} tone="success" label={`Ya recibido de ${plat}`} value={money(montos.recibido)} sub="En tu Billetera" />
            </React.Fragment>
          ))}
        </div>
      )}
      {Object.keys(pendientesPorPlataforma).length > 0 && (
        <div className="subtable-wrap" style={{ marginBottom: 16 }}>
          {Object.entries(pendientesPorPlataforma).map(([plat, ventas]) => (
            <div key={plat} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>Pendiente por cobrar de {plat}</div>
                <button className="btn btn-primary btn-sm" onClick={() => marcarTodoLiquidado(plat)}>
                  <Check size={13} /> Marcar todo como recibido
                </button>
              </div>
              {ventas.map((s) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "4px 0" }}>
                  <span>
                    {fmtDate(s.fecha)} · {s.nombre || "Financiamiento de factura"} ({s.clienteNombre})
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{money(s.montoFinanciadoNeto)}</strong>
                    <button className="link-btn" onClick={() => marcarLiquidado(s.id)}>
                      Marcar recibido
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {data.credits.length === 0 ? (
        <div className="empty-state">No hay créditos activos.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Cliente</th>
              <th>Equipo</th>
              <th>Plataforma</th>
              <th>Total</th>
              <th>Progreso</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.credits.map((c) => {
              const pagadas = c.cuotas.filter((q) => q.pagado).length;
              const pct = c.cuotas.length ? (pagadas / c.cuotas.length) * 100 : 0;
              const status = creditStatus(c);
              const isOpen = expanded === c.id;
              const saldo = c.cuotas.filter((q) => !q.pagado).reduce((s, q) => s + q.monto, 0);
              return (
                <React.Fragment key={c.id}>
                  <tr>
                    <td>
                      <button className="row-expand-btn" onClick={() => setExpanded(isOpen ? null : c.id)}>
                        {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{c.cliente}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{c.cedula}</div>
                    </td>
                    <td>{c.telefono}</td>
                    <td>
                      {c.plataforma && c.plataforma !== "Crédito propio" ? (
                        <Badge tone="primary">{c.plataforma}</Badge>
                      ) : (
                        <Badge tone="neutral">Propio</Badge>
                      )}
                    </td>
                    <td>{money(c.precioTotal)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 3 }}>
                        {pagadas}/{c.cuotas.length} cuotas · saldo {money(saldo)}
                      </div>
                    </td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => remove(c.id)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} style={{ border: "none", padding: "0 10px 12px 10px" }}>
                        <div className="subtable-wrap">
                          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--color-text-muted)" }}>Cronograma de cuotas</div>
                          {c.cuotas.map((q) => {
                            const vencida = !q.pagado && daysBetween(q.fechaVencimiento, todayISO()) > 0;
                            const tieneComision = c.plataforma && c.plataforma !== "Crédito propio" && q.montoNeto != null && q.montoNeto !== q.monto;
                            return (
                              <div className={`cuota-chip ${q.pagado ? "pagado" : ""}`} key={q.numero}>
                                <div className={`checkbox-btn ${q.pagado ? "checked" : ""}`} onClick={() => toggleCuota(c.id, q.numero)}>
                                  {q.pagado && <Check size={13} />}
                                </div>
                                <span style={{ flex: 1, marginLeft: 8 }}>
                                  Cuota {q.numero} · vence {fmtDate(q.fechaVencimiento)}
                                  {vencida && <span style={{ color: "var(--color-danger)", fontWeight: 700 }}> · vencida</span>}
                                  {q.pagado && q.fechaPago && <span style={{ color: "var(--color-success)" }}> · pagada {fmtDate(q.fechaPago)}</span>}
                                  {tieneComision && (
                                    <span style={{ color: "var(--color-text-muted)" }}> · la cobra {c.plataforma} directamente al cliente</span>
                                  )}
                                </span>
                                <span style={{ fontWeight: 700 }}>{money(q.monto)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ==================== GASTOS ====================
function GastosView({ data, setData, money, gastosPorConcepto, PIE_COLORS, walletBalances }) {
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("Efectivo");

  const cuenta = METHOD_TO_ACCOUNT[metodo];
  const disponible = walletBalances[cuenta] || 0;
  const montoNum = Number(monto) || 0;
  const excedeSaldo = montoNum > disponible + 0.01;
  const puedeRegistrar = concepto.trim() && montoNum > 0 && !excedeSaldo;

  const agregarGasto = () => {
    if (!puedeRegistrar) return;
    const registro = { id: uid(), fecha: todayISO(), concepto, monto: montoNum, metodo };
    setData((d) => ({ ...d, gastosGenerales: [registro, ...(d.gastosGenerales || [])] }));
    setConcepto("");
    setMonto("");
  };

  const removeGasto = (id) => setData((d) => ({ ...d, gastosGenerales: d.gastosGenerales.filter((g) => g.id !== id) }));

  const gastos = [...(data.gastosGenerales || [])].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  const total = gastos.reduce((s, g) => s + toNativeCurrency(g.monto, g.metodo, data.currency, data.tasaInterna), 0);

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <Plus size={16} /> Agregar gasto
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Concepto</label>
            <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Alquiler, transporte, sueldo, internet..." />
          </div>
          <div className="field">
            <label>Monto ({currencySymbolFor(metodo)})</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-text-muted)", minWidth: 20 }}>{currencySymbolFor(metodo)}</span>
              <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="field">
            <label>Método de pago</label>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10 }}>
          Disponible en {cuenta}: {fmtAccountAmount(disponible, ACCOUNT_CURRENCY[cuenta])}
        </div>
        {excedeSaldo && (
          <div style={{ fontSize: 11.5, color: "var(--color-danger)", fontWeight: 700, marginBottom: 10 }}>
            Saldo insuficiente en {cuenta}: disponible {fmtAccountAmount(disponible, ACCOUNT_CURRENCY[cuenta])}, intentas gastar{" "}
            {fmtAccountAmount(montoNum, ACCOUNT_CURRENCY[cuenta])}.
          </div>
        )}
        <button className="btn btn-primary" disabled={!puedeRegistrar} onClick={agregarGasto}>
          <Check size={14} /> Registrar gasto
        </button>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8 }}>
          El negocio puede tener infinidad de gastos (alquiler, sueldos, transporte, servicios...): regístralos aquí con su
          método de pago para que se descuenten de la Billetera correspondiente.
        </div>
      </div>

      <div className="stat-grid">
        <Card icon={Receipt} tone="danger" label="Total de gastos del negocio" value={money(total)} sub={`${gastos.length} gastos registrados`} />
      </div>

      {gastosPorConcepto.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <Receipt size={16} /> Por concepto
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={gastosPorConcepto} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => e.name}>
                {gastosPorConcepto.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => money(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">
          <CalendarClock size={16} /> Detalle de gastos
        </div>
        {gastos.length === 0 ? (
          <div className="empty-state">No hay gastos registrados todavía. Agrégalos arriba.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Método</th>
                <th>Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id}>
                  <td>{fmtDate(g.fecha)}</td>
                  <td>{g.concepto}</td>
                  <td>
                    <Badge tone="neutral">{g.metodo}</Badge>
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {fmtAccountAmount(g.monto, ACCOUNT_CURRENCY[METHOD_TO_ACCOUNT[g.metodo]])}
                    <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", fontWeight: 500 }}>
                      ≈ {money(toNativeCurrency(g.monto, g.metodo, data.currency, data.tasaInterna))}
                    </div>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => removeGasto(g.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ==================== BILLETERA DIGITAL ====================
const ACCOUNT_ICON = {
  "Cuenta Bancaria": CreditCard,
  "Punto de Venta": CreditCard,
  Efectivo: Wallet,
  "$ Efectivo": Wallet,
  Zelle: RefreshCw,
  Binance: RefreshCw,
  Cashea: Smartphone,
  Chollo: Smartphone,
  Opercoll: Wifi,
};

const SALE_TIPO_LABEL = {
  "Línea Nueva": "Línea nueva",
  "Cambio/Recuperación de Línea": "Cambio/Recuperación de línea",
  Accesorios: "Accesorios",
  "Teléfono Contado": "Teléfono de contado",
  "Teléfono Crédito": "Inicial de teléfono a crédito",
};

// Collects every transaction that has touched a given wallet account, from every place
// the app can move money in or out of it, for the account's detail/statement view.
function getMovimientosCuenta(data, account) {
  const movs = [];

  // `orden` es la clave de orden real dentro del mismo día: los `id` se generan con Date.now() como
  // prefijo, así que comparar `orden` como texto respeta el momento exacto en que ocurrió cada
  // movimiento, no solo la fecha (que por sí sola no distingue el orden dentro de un mismo día).
  data.sales.forEach((s) => {
    (s.pagos || []).forEach((p) => {
      if (METHOD_TO_ACCOUNT[p.metodo] === account) {
        movs.push({ fecha: s.fecha, orden: s.id, descripcion: `Venta · ${SALE_TIPO_LABEL[s.tipo] || s.tipo} (${s.clienteNombre})`, monto: Number(p.monto) || 0 });
      }
    });
  });

  (data.gastosGenerales || []).forEach((g) => {
    if (METHOD_TO_ACCOUNT[g.metodo] === account) {
      movs.push({ fecha: g.fecha, orden: g.id, descripcion: `Gasto · ${g.concepto}`, monto: -(Number(g.monto) || 0) });
    }
  });

  if (account === "Cashea" || account === "Chollo") {
    data.sales.forEach((s) => {
      if ((s.tipo === "Teléfono Crédito" || s.tipo === "Financiamiento Cashea") && s.plataforma === account && s.liquidado) {
        movs.push({
          fecha: s.fechaLiquidacion || s.fecha,
          orden: s.id,
          descripcion: `Pago recibido · financiamiento ${s.nombre || "de factura"} (${s.clienteNombre})`,
          monto: Number(s.montoFinanciadoNeto) || 0,
        });
      }
    });
  }

  (data.compras || []).forEach((c) => {
    if (METHOD_TO_ACCOUNT[c.metodo] === account) {
      movs.push({ fecha: c.fecha, orden: c.id, descripcion: `Compra inventario · ${c.producto}`, monto: -(Number(c.costoTotal) || 0) });
    }
  });

  (data.ordenesCompra || []).forEach((o) => {
    (o.pagos || []).forEach((p) => {
      if (METHOD_TO_ACCOUNT[p.metodo] === account) {
        movs.push({ fecha: p.fecha || o.fecha, orden: o.id, descripcion: `Pago factura ${o.numeroFactura || "s/n"} · ${o.proveedor || "Proveedor"}`, monto: -(Number(p.monto) || 0) });
      }
    });
  });

  // Opercoll: transferencias que salen de la cuenta de origen, entran a Opercoll con su 5% de
  // bono, y se consumen automáticamente con cada recarga de Línea Nueva.
  (data.transferenciasOpercoll || []).forEach((t) => {
    if (METHOD_TO_ACCOUNT[t.metodo] === account) {
      movs.push({ fecha: t.fecha, orden: t.id, descripcion: "Transferencia a Opercoll", monto: -(Number(t.monto) || 0) });
    }
    if (account === "Opercoll") {
      movs.push({ fecha: t.fecha, orden: t.id, descripcion: `Transferencia recibida (+${OPERCOLL_BONO_PCT}% de bono)`, monto: Number(t.montoAcreditado) || 0 });
    }
  });
  if (account === "Opercoll") {
    data.sales.forEach((s) => {
      if (s.tipo === "Línea Nueva") {
        const montoBs = s.montoRecargaBs != null ? Number(s.montoRecargaBs) : convertNativeToBs(s.montoRecarga, data.currency, data.tasaBCV);
        movs.push({
          fecha: s.fecha,
          orden: s.id,
          descripcion: `Recarga · Línea nueva (${s.clienteNombre})`,
          monto: -montoBs,
        });
      }
    });
  }

  return movs.sort((a, b) => {
    const porFecha = (b.fecha || "").localeCompare(a.fecha || "");
    if (porFecha !== 0) return porFecha;
    return (b.orden || "").localeCompare(a.orden || "");
  });
}

function Billetera({ data, setData, walletBalances }) {
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState(null);
  const [editingSaldos, setEditingSaldos] = useState(false);
  const [saldosForm, setSaldosForm] = useState({});
  const [montoOpercoll, setMontoOpercoll] = useState("");
  const [metodoOpercoll, setMetodoOpercoll] = useState("Efectivo");

  const cuentaOrigenOpercoll = METHOD_TO_ACCOUNT[metodoOpercoll];
  const disponibleOpercoll = walletBalances[cuentaOrigenOpercoll] || 0;
  const montoOpercollNum = Number(montoOpercoll) || 0;
  const excedeSaldoOpercoll = montoOpercollNum > disponibleOpercoll + 0.01;
  const montoAcreditadoOpercoll = toNativeCurrency(montoOpercollNum, metodoOpercoll, "VES", data.tasaInterna) * (1 + OPERCOLL_BONO_PCT / 100);
  const puedeTransferirOpercoll = montoOpercollNum > 0 && !excedeSaldoOpercoll;

  const transferirAOpercoll = () => {
    if (!puedeTransferirOpercoll) return;
    setData((d) => ({
      ...d,
      transferenciasOpercoll: [
        { id: uid(), fecha: todayISO(), monto: montoOpercollNum, metodo: metodoOpercoll, montoAcreditado: montoAcreditadoOpercoll },
        ...(d.transferenciasOpercoll || []),
      ],
    }));
    setMontoOpercoll("");
  };

  const abrirEdicionSaldos = () => {
    const initial = {};
    WALLET_ACCOUNTS.forEach((acc) => {
      const actual = (data.saldosIniciales || {})[acc];
      initial[acc] = actual != null ? String(actual) : "";
    });
    setSaldosForm(initial);
    setEditingSaldos(true);
  };

  const guardarSaldosIniciales = () => {
    const nuevos = {};
    WALLET_ACCOUNTS.forEach((acc) => {
      nuevos[acc] = Number(saldosForm[acc]) || 0;
    });
    setData((d) => ({ ...d, saldosIniciales: nuevos }));
    setEditingSaldos(false);
  };

  const totalUSD = WALLET_ACCOUNTS.reduce((s, acc) => {
    const bal = walletBalances[acc] || 0;
    const usd = ACCOUNT_CURRENCY[acc] === "USD" ? bal : bal / (Number(data.tasaInterna) || 1);
    return s + usd;
  }, 0);
  const totalBs = totalUSD * (Number(data.tasaInterna) || 1);

  if (cuentaSeleccionada) {
    const acc = cuentaSeleccionada;
    const bal = walletBalances[acc] || 0;
    const currency = ACCOUNT_CURRENCY[acc];
    const Icon = ACCOUNT_ICON[acc] || Wallet;
    const movimientos = getMovimientosCuenta(data, acc);
    return (
      <>
        <button className="btn btn-ghost btn-sm" onClick={() => setCuentaSeleccionada(null)} style={{ marginBottom: 14 }}>
          ← Volver a la billetera
        </button>
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Card icon={Icon} tone={bal < 0 ? "danger" : "primary"} label={acc} value={fmtAccountAmount(bal, currency)} sub="Saldo acumulado" />
        </div>
        <div className="panel">
          <div className="panel-title">
            <Icon size={16} /> Movimientos de {acc} ({movimientos.length})
          </div>
          {movimientos.length === 0 ? (
            <div className="empty-state">Todavía no hay movimientos registrados en esta cuenta.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i}>
                    <td>{fmtDate(m.fecha)}</td>
                    <td>{m.descripcion}</td>
                    <td style={{ fontWeight: 700, color: m.monto >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>
                      {m.monto >= 0 ? "+" : "−"}
                      {fmtAccountAmount(Math.abs(m.monto), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <Card
          icon={Wallet}
          tone={totalUSD >= 0 ? "success" : "danger"}
          label="Total general (equivalente)"
          value={`$${totalUSD.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`≈ Bs. ${totalBs.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · tasa interna`}
        />
      </div>

      <div className="panel">
        <div className="panel-title" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Wallet size={16} /> Saldo inicial por cuenta
          </span>
          {!editingSaldos && (
            <button className="btn btn-ghost btn-sm" onClick={abrirEdicionSaldos}>
              <Plus size={13} /> Configurar saldo inicial
            </button>
          )}
        </div>
        {!editingSaldos ? (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            Usa esto una sola vez, al empezar a usar el sistema, para cargar el efectivo/saldo que ya tenías en cada cuenta
            antes de registrar ventas. Los saldos que ves en las tarjetas de abajo ya incluyen este monto inicial más todos
            los movimientos posteriores.
          </div>
        ) : (
          <div>
            <div className="form-grid">
              {WALLET_ACCOUNTS.map((acc) => (
                <div className="field" key={acc}>
                  <label>
                    {acc} <span style={{ color: "var(--color-primary)" }}>({ACCOUNT_CURRENCY[acc] === "USD" ? "$" : "Bs."})</span>
                  </label>
                  <input
                    type="number"
                    value={saldosForm[acc] ?? ""}
                    onChange={(e) => setSaldosForm((f) => ({ ...f, [acc]: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={guardarSaldosIniciales}>
                <Check size={14} /> Guardar saldos iniciales
              </button>
              <button className="btn btn-ghost" onClick={() => setEditingSaldos(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stat-grid">
        {WALLET_ACCOUNTS.map((acc) => {
          const bal = walletBalances[acc] || 0;
          const currency = ACCOUNT_CURRENCY[acc];
          return (
            <div key={acc} onClick={() => setCuentaSeleccionada(acc)} style={{ cursor: "pointer" }}>
              <Card
                icon={ACCOUNT_ICON[acc] || Wallet}
                tone={bal < 0 ? "danger" : "primary"}
                label={acc}
                value={fmtAccountAmount(bal, currency)}
                sub={acc === "Cashea" || acc === "Chollo" ? "Acreditado al vender (neto) · clic para ver detalle" : "Saldo acumulado · clic para ver detalle"}
              />
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="panel-title">
          <Wifi size={16} /> Transferir a Opercoll
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 12 }}>
          Opercoll es la plataforma con la que recargas las líneas nuevas. Transfiere aquí lo que le envíes desde
          cualquiera de tus cuentas y Opercoll te acredita ese monto + {OPERCOLL_BONO_PCT}% de bono para recargar. Cada
          venta de Línea Nueva descuenta automáticamente de Opercoll el mismo monto en Bs. que se cobró por esa recarga.
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Monto a transferir ({currencySymbolFor(metodoOpercoll)})</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-text-muted)", minWidth: 20 }}>
                {currencySymbolFor(metodoOpercoll)}
              </span>
              <input type="number" value={montoOpercoll} onChange={(e) => setMontoOpercoll(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="field">
            <label>Cuenta de origen</label>
            <select value={metodoOpercoll} onChange={(e) => setMetodoOpercoll(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10 }}>
          Disponible en {cuentaOrigenOpercoll}: {fmtAccountAmount(disponibleOpercoll, ACCOUNT_CURRENCY[cuentaOrigenOpercoll])}
          {montoOpercollNum > 0 && !excedeSaldoOpercoll && (
            <> · Opercoll te acreditará {fmtAccountAmount(montoAcreditadoOpercoll, "VES")}</>
          )}
        </div>
        {excedeSaldoOpercoll && (
          <div style={{ fontSize: 11.5, color: "var(--color-danger)", fontWeight: 700, marginBottom: 10 }}>
            Saldo insuficiente en {cuentaOrigenOpercoll}: disponible {fmtAccountAmount(disponibleOpercoll, ACCOUNT_CURRENCY[cuentaOrigenOpercoll])}, intentas
            transferir {fmtAccountAmount(montoOpercollNum, ACCOUNT_CURRENCY[cuentaOrigenOpercoll])}.
          </div>
        )}
        <button className="btn btn-primary" disabled={!puedeTransferirOpercoll} onClick={transferirAOpercoll}>
          <Check size={14} /> Transferir a Opercoll
        </button>
      </div>

      <div className="panel">
        <div className="panel-title">
          <Wallet size={16} /> Cómo se alimenta cada cuenta
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
          <strong>Suma (+)</strong> cada vez que factures una venta cobrada con ese método: Pago Móvil → Cuenta Bancaria,
          Punto de Venta, Zelle, Efectivo, Binance, $ Físico → $ Efectivo, y Cashea (como método de pago directo en cualquier
          venta) → Cashea. <strong>Chollo</strong>, y Cashea cuando es el financiamiento de un teléfono a crédito, suman
          cuando marcas una cuota como pagada en Créditos (ya con su comisión descontada). <strong>Opercoll</strong> suma
          con cada transferencia que le hagas (+{OPERCOLL_BONO_PCT}% de bono) y resta automáticamente con cada recarga de
          Línea Nueva que factures. <strong>Resta (−)</strong> cada gasto adicional
          que registres en una venta de Línea Nueva o Cambio de línea, y cada compra o reposición de inventario, según el
          método de pago que hayas seleccionado en cada una.
        </div>
      </div>
    </>
  );
}
