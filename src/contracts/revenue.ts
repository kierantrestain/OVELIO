// Revenue contracts (wave two): catalogue, deal line items, proposals, invoices, payments, subscriptions and the
// revenue states. Shared by src/server/revenue/ and src/components/revenue/, so totals are computed identically.

export const billingCycles = ['one_time', 'monthly', 'quarterly', 'yearly'] as const;
export type Billing = (typeof billingCycles)[number];
export const billingLabels: Record<Billing, string> = { one_time: 'One-time', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const monthsPer: Record<Exclude<Billing, 'one_time'>, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export type TaxRate = { id: string; name: string; rate: number; isDefault: boolean; archived: boolean };

export type Product = {
  id: string; name: string; sku: string; description: string; kind: 'product' | 'service';
  unitPrice: number; currency: string; billing: Billing; taxRateId: string | null; taxRate: number;
  /** Price list: the price in other currencies. */
  prices: { currency: string; unitPrice: number }[];
  archived: boolean; updatedAt: string;
};

export type LineInput = {
  productId?: string | null; name: string; description?: string; quantity: number; unitPrice: number;
  discountPercent?: number; taxRate?: number; billing?: Billing;
};

export type Line = Required<Omit<LineInput, 'productId'>> & {
  id?: string; productId: string | null;
  /** quantity × unit price. */
  gross: number; discount: number; net: number; tax: number; total: number;
};

export type Totals = { subtotal: number; discountTotal: number; taxTotal: number; total: number; oneTimeNet: number; recurringNet: number; monthlyRecurring: number };

/** Rounds half away from zero to 2 decimals on the decimal representation, so 1.005 → 1.01 (not 1.00). */
export const round2 = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * Number(Math.round(Number(`${Math.abs(value)}e2`)) + 'e-2');
};

export function priceLine(input: LineInput & { id?: string }): Line {
  const quantity = Math.max(0, Number(input.quantity) || 0);
  // Prices are kept to the cent, as the database stores them.
  const unitPrice = round2(Math.max(0, Number(input.unitPrice) || 0));
  const discountPercent = Math.min(100, Math.max(0, Number(input.discountPercent) || 0));
  const taxRate = Math.min(100, Math.max(0, Number(input.taxRate) || 0));
  // Integer hundredths for quantity and price, so the product is exact before rounding.
  const gross = round2(Math.round(quantity * 100) * Math.round(unitPrice * 100) / 10_000);
  const discount = round2(gross * discountPercent / 100);
  const net = round2(gross - discount);
  const tax = round2(net * taxRate / 100);
  return {
    id: input.id, productId: input.productId ?? null, name: input.name.trim(), description: input.description?.trim() ?? '', quantity, unitPrice,
    discountPercent, taxRate, billing: input.billing ?? 'one_time', gross, discount, net, tax, total: round2(net + tax),
  };
}

/** Value per month of a recurring net amount; one-time lines are worth 0 per month. */
export const monthlyValue = (net: number, billing: Billing) => billing === 'one_time' ? 0 : round2(net / monthsPer[billing]);

export function totals(lines: Line[]): Totals {
  const sum = (pick: (line: Line) => number, filter: (line: Line) => boolean = () => true) => round2(lines.filter(filter).reduce((acc, line) => acc + pick(line), 0));
  return {
    subtotal: sum(line => line.gross), discountTotal: sum(line => line.discount), taxTotal: sum(line => line.tax), total: sum(line => line.total),
    oneTimeNet: sum(line => line.net, line => line.billing === 'one_time'), recurringNet: sum(line => line.net, line => line.billing !== 'one_time'),
    monthlyRecurring: sum(line => monthlyValue(line.net, line.billing)),
  };
}

/** Months between invoices for a recurring cycle. */
export const intervalMonths = (billing: Exclude<Billing, 'one_time'>) => monthsPer[billing];

/** Stripe amounts are integers in the currency's minor unit; these currencies have none. */
const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export const toMinorUnits = (amount: number, currency: string) => zeroDecimal.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(round2(amount) * 100);
export const fromMinorUnits = (amount: number, currency: string) => zeroDecimal.has(currency.toUpperCase()) ? amount : round2(amount / 100);

export const quoteStatuses = ['draft', 'sent', 'accepted', 'declined', 'void'] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];

export type QuoteSummary = {
  id: string; number: string; title: string; status: QuoteStatus; expired: boolean; dealId: string | null; dealName: string | null;
  contactId: number | null; contactName: string; contactEmail: string; companyName: string; currency: string; total: number;
  monthlyRecurring: number; validUntil: string | null; sentAt: string | null; viewCount: number; lastViewedAt: string | null;
  acceptedAt: string | null; declinedAt: string | null; updatedAt: string;
};

export type Quote = QuoteSummary & {
  intro: string; terms: string; lines: Line[]; totals: Totals; depositPercent: number; publicUrl: string | null;
  declineReason: string; signerName: string; signerEmail: string; documentHash: string; firstViewedAt: string | null;
  invoices: InvoiceSummary[];
};

export const invoiceStatuses = ['draft', 'open', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];
export type InvoiceKind = 'full' | 'deposit' | 'balance' | 'recurring' | 'manual';

export type InvoiceSummary = {
  id: string; number: string; kind: InvoiceKind; status: InvoiceStatus; overdue: boolean; description: string; currency: string;
  total: number; amountPaid: number; amountRefunded: number; balance: number; issuedAt: string; dueDate: string | null; paidAt: string | null;
  contactId: number | null; contactName: string; contactEmail: string; companyName: string; dealId: string | null; quoteId: string | null;
  quoteNumber: string | null; publicUrl: string | null; paymentUrl: string;
};

export type Payment = {
  id: string; invoiceId: string; invoiceNumber: string; provider: 'stripe' | 'manual'; method: string; amount: number; refunded: number;
  currency: string; note: string; receivedAt: string; contactName: string;
};

export type Invoice = InvoiceSummary & { lines: Line[]; subtotal: number; taxTotal: number; payments: Payment[] };

export type Subscription = {
  id: string; name: string; status: 'active' | 'cancelled'; interval: Exclude<Billing, 'one_time'>; currency: string; amount: number;
  monthlyValue: number; contactId: number | null; contactName: string; companyName: string; dealId: string | null; quoteId: string | null;
  startedAt: string; nextInvoiceAt: string; cancelledAt: string | null; cancelReason: string;
};

/** The revenue states, per currency (no exchange-rate conversion). Pipeline is open deal value; the rest are measured. */
export type RevenueStates = {
  currency: string;
  pipeline: number;
  /** Open deal value × probability: an estimate. */
  weightedPipeline: number;
  contracted: number;
  invoiced: number;
  collected: number;
  refunded: number;
  outstanding: number;
  monthlyRecurring: number;
  activeSubscriptions: number;
};

export type RevenueOverview = {
  from: string; to: string; states: RevenueStates[];
  recentPayments: Payment[];
  stripe: { configured: boolean; webhookConfigured: boolean; mode: 'test' | 'live' | null };
};

export type RevenueSettings = {
  defaultTerms: string;
  paymentInstructions: string;
  quoteValidityDays: number;
  invoiceDueDays: number;
  onboardingTasks: string[];
};

export const defaultRevenueSettings: RevenueSettings = {
  defaultTerms: 'Prices exclude VAT unless shown. Invoices are payable within 14 days. Either party may end recurring services with 30 days’ written notice.',
  paymentInstructions: '',
  quoteValidityDays: 30,
  invoiceDueDays: 14,
  onboardingTasks: ['Kick-off call', 'Collect onboarding information', 'Set up the account'],
};
