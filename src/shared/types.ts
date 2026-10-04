export type Mode = 'fixture' | 'sandbox';
export type Capture = { id: string; orderId: string; merchantId: string; customerId: string; amount: number; currency: string; status: string; mode: Mode };
export type Purchase = Capture & { label: string; purchasedAt: string; grantId: string };
export type Grant = { id: string; captureId: string; customerId: string; active: boolean; expiresAt: string };
export type Evidence = { id: string; label: string; detail: string };
export type RefundCase = { id: string; mode: Mode; merchantId: string; customerId: string; customer: string; email: string; request: string; purchases: Purchase[]; grants: Grant[]; evidence: Evidence[]; scenario?: 'completed' | 'pending' | 'failed' | 'timeout' | 'access_failure'; fixtureTarget?: string; ambiguous?: boolean; createdAt: string };
export type Proposal = { decision: 'refund' | 'clarify'; captureId: string | null; amount: number | null; currency: string | null; reason: string; evidenceIds: string[]; question: string | null; source: 'authored_fixture' | 'gemini' | 'operator'; caseVersion: number };
export type Preview = { id: string; caseId: string; caseVersion: number; merchantId: string; captureId: string; amount: number; currency: string; revokeGrantId: string; retainedGrantIds: string[]; fingerprint: string; createdAt: string; proposal: Proposal };
export type RefundResult = { id: string; captureId: string; amount: number; currency: string; status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'CANCELLED' };
export type Operation = { id: string; requestId: string; preview: Preview; approvedBy: string; approvedAt: string; status: 'executing' | 'complete' | 'pending' | 'partial' | 'rejected' | 'unknown'; provider: 'not_sent' | 'unknown' | RefundResult['status']; refundId?: string; access: 'unchecked' | 'retained' | 'failed'; message: string; updatedAt: string };
export type Approval = Pick<Preview, 'id' | 'fingerprint' | 'merchantId' | 'captureId' | 'amount' | 'currency' | 'caseVersion'>;
export const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);

