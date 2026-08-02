"use client";

import { AdaptiveSegmentIndicators } from "./components/common/AdaptiveSegmentIndicators";
import { useBookMeetController } from "./hooks/useBookMeetController";

export default function BookMeetApp() {
  const screen = useBookMeetController();
  return (
    <>
      <AdaptiveSegmentIndicators />
      {screen}
    </>
  );
}
