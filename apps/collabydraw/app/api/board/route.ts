import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoomBySessionId } from "@/actions/room";
import { generateDeterministicAESKey } from "@/utils/crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "crypto";

const BoardAccessSchema = z.object({
  id: z.string().min(1, "Session ID is required"),
  name: z.string().min(1, "User name is required").max(100),
});

// Session info type from Supabase function
interface SessionInfo {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

/**
 * Validates that a session exists and is confirmed
 * @param sessionId - The session ID to validate
 * @returns Promise<{valid: boolean, isConfirmed: boolean, error?: string}>
 */
async function validateSession(sessionId: string): Promise<{valid: boolean, isConfirmed: boolean, error?: string}> {
  try {
    const supabaseUrl = process.env.SUPABASE_FUNCTION_URL || "https://kwyatmfsrfnpnkyfaphv.supabase.co/functions/v1/get-session-info";
    const url = `${supabaseUrl}?id=${encodeURIComponent(sessionId)}`;
    
    console.log("[SESSION-VALIDATION] Validating session", {
      sessionId,
      url
    });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log("[SESSION-VALIDATION] Session not found", { sessionId });
        return { valid: false, isConfirmed: false, error: "Session not found" };
      }
      
      console.error("[SESSION-VALIDATION] Error fetching session", {
        sessionId,
        status: response.status,
        statusText: response.statusText
      });
      return { valid: false, isConfirmed: false, error: "Failed to validate session" };
    }

    const sessionInfo: SessionInfo = await response.json();
    
    console.log("[SESSION-VALIDATION] Session info received", {
      sessionId,
      status: sessionInfo.status,
      hasId: !!sessionInfo.id
    });

    // Validate that session exists
    if (!sessionInfo.id) {
      console.log("[SESSION-VALIDATION] Invalid session data - no ID", { sessionInfo });
      return { valid: false, isConfirmed: false, error: "Invalid session data" };
    }

    // Check if status is confirmed
    const isConfirmed = sessionInfo.status === "confirmed";
    
    console.log("[SESSION-VALIDATION] Session validation result", {
      sessionId,
      status: sessionInfo.status,
      isConfirmed
    });

    return { valid: true, isConfirmed };
  } catch (error) {
    console.error("[SESSION-VALIDATION] Exception validating session", {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
    return { valid: false, isConfirmed: false, error: "Failed to validate session" };
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("id");
    const userName = searchParams.get("name");

    // Validate parameters
    const validated = BoardAccessSchema.parse({
      id: sessionId || undefined,
      name: userName || undefined,
    });

    // Validate session exists and check if confirmed
    const sessionValidation = await validateSession(validated.id);
    const isReadOnly = !sessionValidation.isConfirmed;
    
    if (!sessionValidation.valid) {
      console.error("[SESSION-VALIDATION] Session validation failed", {
        sessionId: validated.id,
        error: sessionValidation.error
      });
      return NextResponse.json(
        { error: sessionValidation.error || "Session validation failed" },
        { status: 403 }
      );
    }

    // Get or create room with session ID
    const roomResult = await getOrCreateRoomBySessionId(validated.id);

    if (!roomResult.success || !roomResult.room) {
      return NextResponse.json(
        { error: "Failed to create or access board" },
        { status: 500 }
      );
    }

    // Generate deterministic encryption key based on room ID
    // This ensures all clients in the same room use the same key
    const encryptionKey = await generateDeterministicAESKey(validated.id);

    // Generate JWT token for WebSocket authentication
    console.log("[WS-TOKEN] Checking JWT_SECRET availability", {
      hasJwtSecret: !!process.env.JWT_SECRET,
      jwtSecretLength: process.env.JWT_SECRET?.length || 0
    });
    
    if (!process.env.JWT_SECRET) {
      console.error("[WS-TOKEN] JWT_SECRET not found in environment");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Generate unique userId for this user session
    // Each user gets a unique ID even if they're in the same room
    const uniqueUserId = randomUUID();
    console.log("[WS-TOKEN] Generated unique userId", {
      userId: uniqueUserId,
      sessionId: validated.id,
      userName: validated.name
    });

    // Ensure payload is valid
    const payload = { id: uniqueUserId, email: "session@temp.internal" };
    console.log("[WS-TOKEN] JWT payload prepared", {
      payload: payload,
      hasId: !!payload.id,
      hasEmail: !!payload.email
    });
    
    if (!payload || !payload.id) {
      console.error("[WS-TOKEN] Invalid payload structure", {
        payload: payload
      });
      return NextResponse.json(
        { error: "Invalid session data" },
        { status: 500 }
      );
    }

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    console.log("[WS-TOKEN] JWT token generated successfully", {
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20) + "...",
      payload: payload,
      expiresIn: "7d"
    });

    // Build redirect URL with room hash and name query param
    // Query params come before the hash in URLs
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin).replace(/\/$/, '');
    const redirectUrl = `${baseUrl}/?name=${encodeURIComponent(validated.name)}${isReadOnly ? '&readOnly=true' : ''}#room=${validated.id},${encryptionKey}`;

    // Store token in cookie (non-httpOnly so it can be read on client for WebSocket)
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set("accessToken", token, {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      httpOnly: false, // Must be false to read on client for WebSocket
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    // Store read-only status in cookie
    response.cookies.set("isReadOnly", isReadOnly.toString(), {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      httpOnly: false,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    console.log("[WS-TOKEN] Token stored in cookie", {
      cookieName: "accessToken",
      tokenLength: token.length,
      maxAge: 60 * 60 * 24 * 7,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      redirectUrl: redirectUrl,
      sessionId: validated.id,
      userName: validated.name,
      isReadOnly: isReadOnly
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid parameters", details: error.errors },
        { status: 400 }
      );
    }

    console.error("Error accessing board:", error);
    return NextResponse.json(
      { error: "Failed to access board" },
      { status: 500 }
    );
  }
}
