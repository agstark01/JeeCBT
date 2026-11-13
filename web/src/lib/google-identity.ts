import { createRemoteJWKSet, jwtVerify } from "jose";

export interface GoogleLocalProfile {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
    nonce?: string;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
    },
  ): void;
  cancel(): void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleIdentityApi;
      };
    };
  }
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

let scriptPromise: Promise<void> | undefined;

function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const script = existing ?? document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      if (window.google?.accounts?.id) resolve();
      else reject(new Error("Google Identity Services did not initialize."));
    };
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("Could not load Google Identity Services."));
    };
    if (!existing) document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
  expectedNonce: string,
): Promise<GoogleLocalProfile> {
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error("Google sign-in nonce validation failed. Please try again.");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Google did not return a valid account identifier.");
  }

  return {
    sub: payload.sub,
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

export async function mountGoogleSignInButton(
  element: HTMLElement,
  clientId: string,
  onProfile: (profile: GoogleLocalProfile) => void,
  onError: (error: Error) => void,
): Promise<() => void> {
  await loadGoogleIdentityServices();

  const identity = window.google?.accounts?.id;
  if (!identity) throw new Error("Google Identity Services is unavailable.");

  const nonce = crypto.randomUUID();
  identity.initialize({
    client_id: clientId,
    nonce,
    auto_select: false,
    use_fedcm_for_prompt: true,
    callback: (response) => {
      void verifyGoogleCredential(response.credential, clientId, nonce)
        .then(onProfile)
        .catch((error: unknown) => {
          onError(error instanceof Error ? error : new Error("Google sign-in failed."));
        });
    },
  });

  element.replaceChildren();
  identity.renderButton(element, {
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
    logo_alignment: "left",
  });

  return () => {
    identity.cancel();
    element.replaceChildren();
  };
}
