import React, { createContext, useContext } from "react";

const ReadingSessionsEnabled = createContext(false);

export function ReadingSessionsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <ReadingSessionsEnabled.Provider value={enabled}>{children}</ReadingSessionsEnabled.Provider>;
}

export function useReadingSessionsEnabled() {
  return useContext(ReadingSessionsEnabled);
}

export const useReadingSessionsFeature = useReadingSessionsEnabled;
