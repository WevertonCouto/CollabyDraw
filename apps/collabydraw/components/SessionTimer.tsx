"use client"

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface SessionInfo {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface SessionTimerProps {
  sessionInfo: SessionInfo | null;
  onExpiredChange?: (expired: boolean) => void;
}

export function SessionTimer({ sessionInfo, onExpiredChange }: SessionTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!sessionInfo) {
      setTimeRemaining("");
      return;
    }

    const calculateTimeRemaining = () => {
      try {
        // Parse date and times
        const [year, month, day] = sessionInfo.date.split("-").map(Number);
        const [startHour, startMin] = sessionInfo.start_time.split(":").map(Number);
        const [endHour, endMin] = sessionInfo.end_time.split(":").map(Number);

        // Create date objects for start and end times
        const startDateTime = new Date(year, month - 1, day, startHour, startMin, 0);
        const endDateTime = new Date(year, month - 1, day, endHour, endMin, 0);
        const now = new Date();

        // Check if session has ended
        const expired = now >= endDateTime;
        if (expired !== isExpired) {
          setIsExpired(expired);
          onExpiredChange?.(expired);
        }
        
        if (expired) {
          setTimeRemaining("00:00");
          return;
        }

        // Calculate time difference - always show time until end
        let diffMs = endDateTime.getTime() - now.getTime();

        // If current time is before start time, show full duration
        if (now < startDateTime) {
          diffMs = endDateTime.getTime() - startDateTime.getTime();
        }
        
        // If time is negative (session ended), set to 0
        if (diffMs < 0) {
          diffMs = 0;
        }

        const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        // Format as MM:SS or HH:MM:SS
        if (hours > 0) {
          setTimeRemaining(`${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
        } else {
          setTimeRemaining(`${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
        }
      } catch (error) {
        console.error("[SESSION-TIMER] Error calculating time:", error);
        setTimeRemaining("");
      }
    };

    // Calculate immediately
    calculateTimeRemaining();

    // Update every second
    const interval = setInterval(calculateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [sessionInfo]);

  if (!sessionInfo || !timeRemaining) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800 ${isExpired ? "opacity-50" : ""}`}>
      <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
      <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
        {timeRemaining}
      </span>
    </div>
  );
}
