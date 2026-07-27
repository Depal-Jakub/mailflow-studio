import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const url = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const email = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
const organizationName = required("BOOTSTRAP_ORGANIZATION_NAME");
const organizationSlug = required("BOOTSTRAP_ORGANIZATION_SLUG")
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-|-$/g, "");

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const findExistingUser = async () => {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
};

let user = await findExistingUser();
let invited = false;
if (!user) {
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: email.split("@")[0] },
    redirectTo: process.env.PUBLIC_APP_URL || undefined,
  });
  if (error) throw error;
  user = data.user;
  invited = true;
}
if (!user) throw new Error("Could not create or locate the administrator");

const { data: existingOrganization, error: lookupError } = await supabase
  .from("organizations")
  .select("id, name, slug")
  .eq("slug", organizationSlug)
  .maybeSingle();
if (lookupError) throw lookupError;

let organization = existingOrganization;
if (!organization) {
  const { data, error } = await supabase
    .from("organizations")
    .insert({ name: organizationName, slug: organizationSlug })
    .select("id, name, slug")
    .single();
  if (error) throw error;
  organization = data;
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: user.id,
  full_name: user.user_metadata?.full_name ?? email.split("@")[0],
});
if (profileError) throw profileError;

const { error: membershipError } = await supabase
  .from("organization_members")
  .upsert(
    {
      organization_id: organization.id,
      user_id: user.id,
      role: "owner",
      status: "active",
      joined_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" },
  );
if (membershipError) throw membershipError;

console.log(
  JSON.stringify(
    {
      ok: true,
      invited,
      adminEmail: email,
      organization,
      nextStep: invited
        ? "Open the Supabase invitation email and set a password."
        : "The existing user now owns this organization.",
    },
    null,
    2,
  ),
);
