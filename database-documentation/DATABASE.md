# KovaPage Database Documentation

**Generated**: 1/3/2026, 7:30:28 PM
**Database**: kovapage
**Schema**: public

## 📋 otps

**Description**: No description

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NOT NULL | — |  |
| email | character varying | NOT NULL | — | Unique user email |
| otp | character varying | NOT NULL | — | 6-digit verification code |
| expiresAt | timestamp with time zone | NOT NULL | — |  |
| isUsed | boolean | NULL | false |  |
| attemptCount | integer | NULL | 0 |  |
| createdAt | timestamp with time zone | NOT NULL | — |  |
| updatedAt | timestamp with time zone | NOT NULL | — |  |

## 📋 users

**Description**: No description

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | NOT NULL | — |  |
| name | character varying | NOT NULL | — |  |
| email | character varying | NOT NULL | — | Unique user email |
| password | character varying | NULL | — | Bcrypt hashed password |
| role | USER-DEFINED | NULL | 'auditor'::enum_users_role |  |
| isEmailVerified | boolean | NULL | false |  |
| isActive | boolean | NULL | true |  |
| authMethod | USER-DEFINED | NULL | 'email_otp'::"enum_users_authMethod" |  |
| lastLogin | timestamp with time zone | NULL | — |  |
| createdAt | timestamp with time zone | NOT NULL | — |  |
| updatedAt | timestamp with time zone | NOT NULL | — |  |

