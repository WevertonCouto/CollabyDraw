import client from "@repo/db/client";

const SYSTEM_USER_ID = "system-user-collabydraw";
const SYSTEM_USER_EMAIL = "system@collabydraw.internal";
const SYSTEM_USER_NAME = "System User";
// Pre-hashed password (hash of "system-password-not-used" with bcrypt, rounds=10)
// This user will never be used for authentication, so a fixed hash is safe
const SYSTEM_USER_PASSWORD_HASH = "$2b$10$IEzc3Z5zTlQeH.dBVYgjPusMZjLcGMzNneqgfWiY/9CQ73W69FDie";

/**
 * Ensures that a system user exists in the database.
 * This user is used as the adminId for session-based rooms.
 * @returns The ID of the system user
 */
export async function ensureSystemUser(): Promise<string> {
  // Try to find existing system user first
  const existingUser = await client.user.findUnique({
    where: { id: SYSTEM_USER_ID },
  });

  if (existingUser) {
    return existingUser.id;
  }

  // Try to find by email as fallback
  const existingByEmail = await client.user.findUnique({
    where: { email: SYSTEM_USER_EMAIL },
  });

  if (existingByEmail) {
    return existingByEmail.id;
  }

  // Use upsert to create or get existing user atomically
  // This avoids race conditions and potential issues with PrismaAdapter
  try {
    const systemUser = await client.user.upsert({
      where: { id: SYSTEM_USER_ID },
      update: {}, // Don't update if exists
      create: {
        id: SYSTEM_USER_ID,
        name: SYSTEM_USER_NAME,
        email: SYSTEM_USER_EMAIL,
        password: SYSTEM_USER_PASSWORD_HASH,
      },
    });

    return systemUser.id;
  } catch (error: unknown) {
    // Log the full error for debugging
    console.error("Error ensuring system user - Full error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    
    // Try one more time to find the user (in case it was created by another process)
    const user = await client.user.findUnique({
      where: { id: SYSTEM_USER_ID },
    });
    if (user) {
      return user.id;
    }
    
    const userByEmail = await client.user.findUnique({
      where: { email: SYSTEM_USER_EMAIL },
    });
    if (userByEmail) {
      return userByEmail.id;
    }
    
    throw error;
  }
}
