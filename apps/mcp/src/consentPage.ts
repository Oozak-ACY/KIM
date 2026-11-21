/**
 * The page Supabase Auth sends the user to when an assistant asks to connect
 * to KIM. The user signs in with the Google account or email they linked in
 * the app, then approves or denies. An email link never creates an Account:
 * Captures must land in the user's existing Cards.
 */
export function consentPage(config: {
  supabaseUrl: string;
  supabaseKey: string;
}): string {
  // Safe inside a script element: no "</script>" can close it early.
  const configJson = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KIM</title>
<style>
  :root { color-scheme: light dark; --ink: #1b1b1f; --paper: #fbfaf7; --accent: #3a5bd9; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ecebe8; --paper: #17171a; --accent: #8ea4ff; } }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 420px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 28px; margin: 0 0 16px; }
  button, input { font: inherit; width: 100%; box-sizing: border-box; padding: 12px; margin-top: 12px; border-radius: 8px; }
  input { border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent); background: transparent; color: inherit; }
  button { border: 0; background: var(--accent); color: var(--paper); cursor: pointer; }
  button.quiet { background: transparent; color: var(--accent); }
  [hidden] { display: none; }
</style>
</head>
<body>
<main>
  <h1>KIM</h1>
  <p id="message"></p>
  <section id="sign-in" hidden>
    <button id="google"></button>
    <form id="email-form">
      <input id="email" type="email" required autocomplete="email">
      <button id="email-send" type="submit"></button>
    </form>
  </section>
  <section id="consent" hidden>
    <button id="approve"></button>
    <button id="deny" class="quiet"></button>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.1/dist/umd/supabase.js"></script>
<script>
const config = ${configJson};
const french = navigator.language.toLowerCase().startsWith("fr");
const t = french
  ? {
      signIn: "Connectez-vous avec le compte Google ou l'e-mail lié dans l'app KIM.",
      google: "Continuer avec Google",
      email: "Adresse e-mail",
      sendEmail: "Recevoir un lien de connexion",
      emailSent: "Ouvrez le lien envoyé par e-mail dans ce navigateur.",
      emailFailed: "Aucun compte KIM lié à cette adresse, ou l'envoi a échoué.",
      asks: (client) => client + " veut enregistrer des Cartes dans votre KIM.",
      approve: "Autoriser",
      deny: "Refuser",
      failed: "Cette demande de connexion n'est plus valable. Recommencez depuis votre assistant.",
    }
  : {
      signIn: "Sign in with the Google account or email you linked in the KIM app.",
      google: "Continue with Google",
      email: "Email address",
      sendEmail: "Email me a sign-in link",
      emailSent: "Open the link we emailed you in this browser.",
      emailFailed: "No KIM account is linked to this address, or sending failed.",
      asks: (client) => client + " wants to save Cards to your KIM.",
      approve: "Allow",
      deny: "Deny",
      failed: "This connection request is no longer valid. Start again from your assistant.",
    };

const $ = (id) => document.getElementById(id);
const say = (text) => ($("message").textContent = text);
$("google").textContent = t.google;
$("email").placeholder = t.email;
$("email").setAttribute("aria-label", t.email);
$("email-send").textContent = t.sendEmail;
$("approve").textContent = t.approve;
$("deny").textContent = t.deny;

const authorizationId = new URLSearchParams(location.search).get("authorization_id");
// Not "supabase": the library already owns that global name.
const kim = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { flowType: "pkce", detectSessionInUrl: true },
});
// Back on this page with authorization_id once signed in.
const here = location.origin + location.pathname + "?authorization_id=" + encodeURIComponent(authorizationId ?? "");

function showSignIn() {
  say(t.signIn);
  $("sign-in").hidden = false;
  $("google").onclick = () =>
    kim.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here } });
  $("email-form").onsubmit = async (event) => {
    event.preventDefault();
    const { error } = await kim.auth.signInWithOtp({
      email: $("email").value.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: here },
    });
    say(error ? t.emailFailed : t.emailSent);
  };
}

async function showConsent() {
  const { data, error } = await kim.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return say(t.failed);
  if (!("authorization_id" in data)) return location.assign(data.redirect_url);
  say(t.asks(data.client.name));
  $("consent").hidden = false;
  // Each call sends the browser back to the assistant, or fails.
  const decide = async (choose) => {
    const { error } = await choose(authorizationId);
    if (error) say(t.failed);
  };
  $("approve").onclick = () => decide((id) => kim.auth.oauth.approveAuthorization(id));
  $("deny").onclick = () => decide((id) => kim.auth.oauth.denyAuthorization(id));
}

(async () => {
  if (!authorizationId) return say(t.failed);
  const { data } = await kim.auth.getUser();
  // Only a linked Account may connect an assistant.
  if (!data.user || data.user.is_anonymous) return showSignIn();
  await showConsent();
})();
</script>
</body>
</html>`;
}
