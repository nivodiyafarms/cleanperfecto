function referralHooksActive(): boolean {
  return process.env.VITEST !== "true";
}

async function repository() {
  const { createSupabaseReferralRepository } = await import("./supabase-referral-repository");
  return createSupabaseReferralRepository();
}

export async function previewReferralCreditAmount(serviceVisitId: string): Promise<number> {
  if (!referralHooksActive()) return 0;
  try {
    return await (await repository()).previewCredit(serviceVisitId);
  } catch {
    console.error("[referrals] preview failed");
    return 0;
  }
}

export async function reserveReferralCreditAmount(serviceVisitId: string): Promise<number> {
  if (!referralHooksActive()) return 0;
  try {
    return await (await repository()).reserveCredit(serviceVisitId);
  } catch {
    console.error("[referrals] reserve failed");
    return 0;
  }
}

export async function onVisitMayQualify(serviceVisitId: string): Promise<void> {
  if (!referralHooksActive()) return;
  try {
    const repo = await repository();
    await repo.syncQualification(serviceVisitId);
    await repo.consumeRedemption(serviceVisitId);
  } catch {
    console.error("[referrals] qualification sync failed");
  }
}

export async function onVisitCancelled(serviceVisitId: string): Promise<void> {
  if (!referralHooksActive()) return;
  try {
    await (await repository()).restoreRedemption(serviceVisitId);
  } catch {
    console.error("[referrals] restore failed");
  }
}

export async function onQualifyingPaymentReversed(serviceVisitId: string): Promise<void> {
  if (!referralHooksActive()) return;
  try {
    await (await repository()).reverseForVisit(serviceVisitId);
  } catch {
    console.error("[referrals] reversal failed");
  }
}

export async function onPaymentMethodSaved(customerId: string, paymentMethodId: string): Promise<void> {
  if (!referralHooksActive()) return;
  try {
    await (await repository()).flagSharedPaymentMethod(customerId, paymentMethodId);
  } catch {
    console.error("[referrals] shared-payment flag failed");
  }
}
