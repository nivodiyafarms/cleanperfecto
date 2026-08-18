export interface CustomerRecord {
  id: string;
  name: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  phoneNormalized: string | null;
}

export interface NewCustomerInput {
  name: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  phoneNormalized: string | null;
}

export interface CustomerContactPatch {
  name?: string;
  email?: string;
  emailNormalized?: string;
  phone?: string;
  phoneNormalized?: string;
}

/**
 * Abstraction over customers table access so resolveCustomer stays testable
 * without a real Supabase connection (see supabase-repository.ts for the
 * production implementation). customers.email_normalized/phone_normalized
 * deliberately have no UNIQUE constraint (owner-approved design), so lookups
 * return every match rather than assuming at most one.
 */
export interface CustomerLookupRepository {
  findByEmailNormalized(emailNormalized: string): Promise<CustomerRecord[]>;
  findByPhoneNormalized(phoneNormalized: string): Promise<CustomerRecord[]>;
  createCustomer(input: NewCustomerInput): Promise<CustomerRecord>;
  updateCustomerContact(customerId: string, patch: CustomerContactPatch): Promise<void>;
}
