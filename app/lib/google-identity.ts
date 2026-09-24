export type GoogleIdentityCredentialResponse = { credential: string };

export type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; locale?: string; callback: (response: GoogleIdentityCredentialResponse) => void | Promise<void> }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
      prompt: () => void;
    };
  };
};

export function getGoogleIdentity(): GoogleIdentity | undefined {
  return typeof window === "undefined" ? undefined : (window as Window & { google?: GoogleIdentity }).google;
}
