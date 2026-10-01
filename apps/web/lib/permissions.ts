export const rolePermissions = {
  OWNER: ["family:manage", "members:manage", "documents:read", "documents:upload", "documents:approve", "documents:verify", "audit:read"],
  ADMIN: ["family:manage", "members:manage", "documents:read", "documents:upload", "documents:approve", "documents:verify", "audit:read"],
  MEMBER: ["documents:read", "documents:upload"],
  UPLOADER: ["documents:read", "documents:upload"],
  VIEWER: ["documents:read"]
} as const;

export function can(role: keyof typeof rolePermissions, permission: string) { return (rolePermissions[role] as readonly string[]).includes(permission); }
