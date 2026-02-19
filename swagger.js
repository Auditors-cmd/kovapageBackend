const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'KovaPage Backend API',
    version: '1.0.0',
    description: `
# KovaPage - Complete Audit Management API with PostgreSQL

## Overview
Complete audit management system with 8 specialized user roles, OTP and password-based authentication, user management, and password reset functionality using PostgreSQL database.

## User Roles (8 Levels)
| Role | Level | Description |
|------|-------|-------------|
| **Auditee** | 1 | Business unit being audited - can respond to findings |
| **Implementation Officer** | 2 | Implements audit recommendations |
| **Team Member** | 3 | Works on audits, collects evidence |
| **Team Lead** | 4 | Leads audit team, reviews work |
| **Quality Assurance** | 5 | Ensures audit quality standards |
| **Unit Head** | 6 | Manages audit unit/department |
| **BAC/Secretariat** | 7 | Administrative & committee support |
| **Chief Audit Executive** | 8 | Top leadership, final approvals |

## Authentication Methods
- **OTP Authentication**: Email-based one-time password for registration and login
- **Password Authentication**: Traditional email/password registration and login
- **Password Reset**: Secure OTP-based password reset flow

## Password Requirements
- **Minimum Length**: 8 characters
- **Mix of letters & numbers recommended**

## Database
- **PostgreSQL**: Relational database for user management
- **UUID Primary Keys**: Secure user identification
- **Data Validation**: Comprehensive input validation
- **Role Hierarchy**: 8-level role-based access control

## Rate Limiting
- Authentication endpoints: 10 requests per 15 minutes

## Support
- Email: support@kovapage.com
- Documentation: /api-docs
- Health Check: /api/health
    `,
    contact: {
      name: 'KovaPage Support',
      email: 'support@kovapage.com'
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html'
    }
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Development server'
    },
    {
      url: 'https://kovapagebackend.onrender.com',
      description: 'Production server'
    }
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'User registration and login endpoints'
    },
    {
      name: 'Password Reset', 
      description: 'Password recovery and reset endpoints'
    },
    {
      name: 'User Management',
      description: 'User profile, roles, and management endpoints'
    },
    {
      name: 'Role Management',
      description: 'Role selection and management endpoints'
    },
    {
      name: 'Profile',
      description: 'Profile photo and personal information management'
    },
    {
      name: 'Quality Assurance',
      description: 'QA dashboard, risk assessment, and audit plan consolidation'
    },
    {
      name: 'Admin',
      description: 'Administrative endpoints for user management'
    },
    {
      name: 'Health',
      description: 'API health monitoring'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained after successful authentication'
      }
    },
    schemas: {
      // Error Schemas
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          message: {
            type: 'string',
            description: 'Error message'
          }
        },
        example: {
          success: false,
          message: "An error occurred"
        }
      },

      // User Role Enum with all 8 roles
      UserRole: {
        type: 'string',
        enum: [
          'auditee',
          'implementation_officer',
          'team_member',
          'team_lead',
          'quality_assurance',
          'unit_head',
          'bac_secretariat',
          'chief_audit_executive'
        ],
        description: 'User role in the audit system (8 levels)',
        example: 'quality_assurance'
      },

      // Request Schemas
      RegisterWithPhotoRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: {
            type: 'string',
            example: 'John Doe',
            description: 'User full name'
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'john.doe@company.com',
            description: 'User email address'
          },
          password: {
            type: 'string',
            format: 'password',
            example: 'password123',
            description: 'User password (min 8 characters)'
          },
          profilePhoto: {
            type: 'string',
            format: 'binary',
            description: 'Profile photo image file (jpeg, png, gif, webp) - max 5MB'
          }
        }
      },

      UpdateRoleRequest: {
        type: 'object',
        required: ['role'],
        properties: {
          role: {
            $ref: '#/components/schemas/UserRole'
          }
        },
        example: {
          role: 'quality_assurance'
        }
      },

      RoleStatusResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              currentRole: { $ref: '#/components/schemas/UserRole' },
              needsSelection: { type: 'boolean', example: true },
              roleSelectedAt: { type: 'string', format: 'date-time', nullable: true },
              availableRoles: {
                type: 'array',
                items: { $ref: '#/components/schemas/UserRole' }
              },
              dashboard: { type: 'string', example: '/qa/dashboard' }
            }
          }
        }
      },

      OTPRegisterRequest: {
        type: 'object',
        required: ['email', 'name'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com',
            description: 'User email address'
          },
          name: {
            type: 'string',
            example: 'John Auditor',
            description: 'User full name (2-50 characters)'
          },
          profilePhoto: {
            type: 'string',
            format: 'binary',
            description: 'Profile photo image file (optional)'
          }
        }
      },
      
      OTPVerifyRequest: {
        type: 'object',
        required: ['email', 'name', 'otp'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com'
          },
          name: {
            type: 'string',
            example: 'John Auditor'
          },
          otp: {
            type: 'string',
            example: '123456',
            description: '6-digit OTP code'
          }
        },
        example: {
          email: 'auditor@company.com',
          name: 'John Auditor',
          otp: '123456'
        }
      },
      
      OTPLoginRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com'
          }
        }
      },
      
      OTPVerifyLoginRequest: {
        type: 'object',
        required: ['email', 'otp'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com'
          },
          otp: {
            type: 'string',
            example: '123456',
            description: '6-digit OTP code'
          }
        }
      },
      
      PasswordRegisterRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: {
            type: 'string',
            example: 'John Auditor',
            description: 'User full name (2-50 characters)'
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com',
            description: 'User email address'
          },
          password: {
            type: 'string',
            format: 'password',
            example: 'password123',
            description: 'User password (min 8 characters)'
          }
        },
        example: {
          name: 'John Auditor',
          email: 'auditor@company.com',
          password: 'password123'
        }
      },
      
      PasswordLoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com'
          },
          password: {
            type: 'string',
            format: 'password',
            example: 'password123'
          }
        },
        example: {
          email: 'auditor@company.com',
          password: 'password123'
        }
      },
      
      ForgotPasswordRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com'
          }
        },
        example: {
          email: 'auditor@company.com'
        }
      },
      
      ResetPasswordRequest: {
        type: 'object',
        required: ['email', 'otp', 'newPassword'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'auditor@company.com'
          },
          otp: {
            type: 'string',
            example: '123456',
            description: '6-digit reset OTP code'
          },
          newPassword: {
            type: 'string',
            format: 'password',
            example: 'newpassword123',
            description: 'New password (min 8 characters)'
          }
        },
        example: {
          email: 'auditor@company.com',
          otp: '123456',
          newPassword: 'newpassword123'
        }
      },

      // Admin Create User Request
      AdminCreateUserRequest: {
        type: 'object',
        required: ['name', 'email', 'role'],
        properties: {
          name: {
            type: 'string',
            example: 'Jane Manager',
            description: 'User full name'
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'jane.manager@company.com',
            description: 'User email address'
          },
          password: {
            type: 'string',
            format: 'password',
            example: 'password123',
            description: 'Optional password - if not provided, OTP auth will be used (min 8 chars if provided)'
          },
          role: {
            $ref: '#/components/schemas/UserRole'
          },
          department: {
            type: 'string',
            example: 'Internal Audit',
            description: 'Department or unit'
          },
          employeeId: {
            type: 'string',
            example: 'EMP-2024-001',
            description: 'Unique employee identifier'
          },
          reportsTo: {
            type: 'string',
            format: 'uuid',
            example: '123e4567-e89b-12d3-a456-426614174000',
            description: 'Manager/supervisor user ID'
          }
        },
        example: {
          name: 'Jane Manager',
          email: 'jane.manager@company.com',
          role: 'unit_head',
          department: 'Internal Audit',
          employeeId: 'EMP-2024-001',
          reportsTo: '123e4567-e89b-12d3-a456-426614174000'
        }
      },

      // QA Dashboard Schemas
      RiskAssessmentUploadRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', example: 'Q1 Risk Assessment' },
          description: { type: 'string', example: 'Operational risk assessment for Q1' },
          department: { type: 'string', example: 'Finance' },
          assessmentDate: { type: 'string', format: 'date', example: '2024-01-15' },
          riskFile: {
            type: 'string',
            format: 'binary',
            description: 'Risk data file (Excel, JSON, or CSV)'
          }
        }
      },

      AuditPerformanceData: {
        type: 'object',
        properties: {
          currentYear: {
            type: 'object',
            properties: {
              year: { type: 'integer', example: 2026 },
              quarters: {
                type: 'object',
                properties: {
                  Q1: { type: 'integer', example: 12 },
                  Q2: { type: 'integer', example: 15 },
                  Q3: { type: 'integer', example: 8 },
                  Q4: { type: 'integer', example: 10 }
                }
              }
            }
          },
          priorYear: {
            type: 'object',
            properties: {
              year: { type: 'integer', example: 2025 },
              quarters: {
                type: 'object',
                properties: {
                  Q1: { type: 'integer', example: 16 },
                  Q2: { type: 'integer', example: 15 },
                  Q3: { type: 'integer', example: 6 },
                  Q4: { type: 'integer', example: 6 }
                }
              }
            }
          }
        }
      },

      QuarterlyVarianceData: {
        type: 'object',
        properties: {
          quarters: {
            type: 'array',
            items: { type: 'string', example: 'Q1' }
          },
          variance: {
            type: 'array',
            items: { type: 'integer', example: -4 }
          },
          percentChange: {
            type: 'array',
            items: { type: 'integer', example: -25 }
          }
        }
      },

      QADashboardDataResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              charts: {
                type: 'object',
                properties: {
                  auditPerformance: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      description: { type: 'string' },
                      data: { $ref: '#/components/schemas/AuditPerformanceData' },
                      chartType: { type: 'string', example: 'bar' }
                    }
                  },
                  quarterlyVariance: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      description: { type: 'string' },
                      data: { $ref: '#/components/schemas/QuarterlyVarianceData' },
                      chartType: { type: 'string', example: 'line' }
                    }
                  }
                }
              },
              actions: {
                type: 'object',
                properties: {
                  uploadRiskData: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      count: { type: 'integer' },
                      route: { type: 'string' }
                    }
                  },
                  monitoringDashboard: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      route: { type: 'string' }
                    }
                  },
                  consolidatePlans: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      count: { type: 'integer' },
                      route: { type: 'string' }
                    }
                  }
                }
              },
              metrics: {
                type: 'object',
                properties: {
                  pendingApprovals: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      count: { type: 'integer' }
                    }
                  },
                  reportsToReview: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      count: { type: 'integer' }
                    }
                  },
                  readyForConsolidation: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      count: { type: 'integer' }
                    }
                  },
                  auditHistory: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      total: { type: 'integer' },
                      byStatus: { type: 'object' }
                    }
                  }
                }
              },
              summary: {
                type: 'object',
                properties: {
                  totalAudits: { type: 'integer' },
                  pendingReviews: { type: 'integer' },
                  completedThisYear: { type: 'integer' }
                }
              }
            }
          }
        }
      },

      // User Response with all fields
      UserResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'User UUID'
          },
          name: {
            type: 'string',
            description: 'User name'
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'User email'
          },
          role: {
            $ref: '#/components/schemas/UserRole'
          },
          profilePhoto: {
            type: 'string',
            description: 'Profile photo filename'
          },
          profilePhotoUrl: {
            type: 'string',
            description: 'Full URL to profile photo',
            example: 'https://kovapagebackend.onrender.com/uploads/profiles/profile-123456.jpg'
          },
          department: {
            type: 'string',
            description: 'Department or unit',
            example: 'Internal Audit'
          },
          employeeId: {
            type: 'string',
            description: 'Unique employee identifier',
            example: 'EMP-2024-001'
          },
          reportsTo: {
            type: 'string',
            format: 'uuid',
            description: 'Manager/supervisor user ID',
            example: '123e4567-e89b-12d3-a456-426614174000'
          },
          isEmailVerified: {
            type: 'boolean',
            description: 'Email verification status'
          },
          isActive: {
            type: 'boolean',
            description: 'Account active status'
          },
          authMethod: {
            type: 'string',
            enum: ['email_otp', 'password'],
            description: 'Authentication method'
          },
          lastLogin: {
            type: 'string',
            format: 'date-time',
            description: 'Last login timestamp'
          },
          needsRoleSelection: {
            type: 'boolean',
            description: 'Whether user needs to select a role'
          },
          dashboard: {
            type: 'string',
            description: 'URL to user\'s role-specific dashboard',
            example: '/qa/dashboard'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'User creation timestamp'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Last update timestamp'
          }
        },
        example: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Jane Manager',
          email: 'jane.manager@company.com',
          role: 'quality_assurance',
          profilePhoto: 'profile-123456.jpg',
          profilePhotoUrl: 'https://kovapagebackend.onrender.com/uploads/profiles/profile-123456.jpg',
          department: 'Internal Audit',
          employeeId: 'EMP-2024-001',
          reportsTo: '123e4567-e89b-12d3-a456-426614174000',
          isEmailVerified: true,
          isActive: true,
          authMethod: 'password',
          lastLogin: '2024-01-15T10:30:00.000Z',
          needsRoleSelection: false,
          dashboard: '/qa/dashboard',
          createdAt: '2024-01-15T10:00:00.000Z',
          updatedAt: '2024-01-15T10:30:00.000Z'
        }
      },

      // Manager/Subordinate Response
      ManagerResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          name: {
            type: 'string'
          },
          email: {
            type: 'string',
            format: 'email'
          },
          role: {
            $ref: '#/components/schemas/UserRole'
          },
          department: {
            type: 'string'
          }
        },
        example: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'John Chief',
          email: 'john.chief@company.com',
          role: 'chief_audit_executive',
          department: 'Executive'
        }
      },

      AuthResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string'
          },
          data: {
            type: 'object',
            properties: {
              user: {
                $ref: '#/components/schemas/UserResponse'
              },
              token: {
                type: 'string',
                description: 'JWT access token'
              }
            }
          }
        }
      },
      
      OTPResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string'
          },
          data: {
            type: 'object',
            properties: {
              email: {
                type: 'string'
              },
              name: {
                type: 'string'
              },
              hasProfilePhoto: {
                type: 'boolean'
              }
            }
          }
        },
        example: {
          success: true,
          message: 'Verification code sent to auditor@company.com',
          data: {
            email: 'auditor@company.com',
            name: 'John Auditor',
            hasProfilePhoto: true
          }
        }
      },
      
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            example: 'OK'
          },
          message: {
            type: 'string'
          },
          timestamp: {
            type: 'string',
            format: 'date-time'
          },
          uptime: {
            type: 'number'
          },
          environment: {
            type: 'string'
          },
          database: {
            type: 'string'
          }
        },
        example: {
          status: 'OK',
          message: 'KovaPage API with PostgreSQL is running!',
          timestamp: '2024-01-15T10:30:00.000Z',
          uptime: 3600,
          environment: 'development',
          database: 'PostgreSQL - Connected'
        }
      }
    },
    responses: {
      BadRequest: {
        description: 'Bad request - validation failed',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              success: false,
              message: 'Please provide all required fields'
            }
          }
        }
      },
      Unauthorized: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              success: false,
              message: 'Not authorized'
            }
          }
        }
      },
      Forbidden: {
        description: 'Insufficient permissions',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              success: false,
              message: 'Access denied. Requires team_lead role or higher.'
            }
          }
        }
      },
      ServerError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              success: false,
              message: 'Server error during operation'
            }
          }
        }
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            },
            example: {
              success: false,
              message: 'User not found'
            }
          }
        }
      }
    }
  },
  paths: {
    // =======================
    // HEALTH & TEST ENDPOINTS
    // =======================
    '/api/health': {
      get: {
        summary: 'Health Check',
        description: 'Check API health status and PostgreSQL database connection',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'API is healthy and database is connected',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse'
                }
              }
            }
          },
          '503': {
            description: 'Database connection failed',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          }
        }
      }
    },
    '/api/test': {
      get: {
        summary: 'Test Endpoint',
        description: 'Simple test endpoint to verify API functionality',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'Test successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true
                    },
                    message: {
                      type: 'string'
                    },
                    timestamp: {
                      type: 'string',
                      format: 'date-time'
                    }
                  },
                  example: {
                    success: true,
                    message: 'Test endpoint working!',
                    timestamp: '2024-01-15T10:30:00.000Z'
                  }
                }
              }
            }
          }
        }
      }
    },

    // =======================
    // PASSWORD AUTHENTICATION
    // =======================
    '/api/auth/register': {
      post: {
        summary: 'Register with Password and Profile Photo',
        description: 'Register a new user with email, password (min 8 characters), and optional profile photo',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/RegisterWithPhotoRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'User registered successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse'
                },
                example: {
                  success: true,
                  message: 'User registered successfully! Please complete your profile.',
                  data: {
                    user: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'John Doe',
                      email: 'john@company.com',
                      role: 'auditee',
                      profilePhoto: 'profile-123456.jpg',
                      profilePhotoUrl: 'https://kovapagebackend.onrender.com/uploads/profiles/profile-123456.jpg',
                      isEmailVerified: false,
                      authMethod: 'password',
                      lastLogin: '2024-01-15T10:30:00.000Z',
                      needsRoleSelection: true
                    },
                    token: 'jwt_token_123456'
                  }
                }
              }
            }
          },
          '400': {
            description: 'Bad request - validation failed (password must be at least 8 characters)',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                },
                example: {
                  success: false,
                  message: 'Password must be at least 8 characters'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },
    '/api/auth/login': {
      post: {
        summary: 'Login with Password',
        description: 'Authenticate user with email and password',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PasswordLoginRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse'
                },
                example: {
                  success: true,
                  message: 'Welcome back, John!',
                  data: {
                    user: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'John Doe',
                      email: 'john@company.com',
                      role: 'quality_assurance',
                      profilePhotoUrl: 'https://kovapagebackend.onrender.com/uploads/profiles/profile-123456.jpg',
                      dashboard: '/qa/dashboard',
                      needsRoleSelection: false
                    },
                    token: 'jwt_token_123456'
                  }
                }
              }
            }
          },
          '401': {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },

    // =======================
    // ROLE MANAGEMENT
    // =======================
    '/api/auth/update-role': {
      put: {
        summary: 'Update User Role',
        description: 'Update user role after registration',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdateRoleRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Role updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        role: { $ref: '#/components/schemas/UserRole' },
                        dashboard: { type: 'string' },
                        welcomeMessage: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/role-status': {
      get: {
        summary: 'Check Role Status',
        description: 'Check if user needs to select a role',
        tags: ['Role Management'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Role status retrieved',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RoleStatusResponse'
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    // =======================
    // PROFILE MANAGEMENT
    // =======================
    '/api/auth/update-photo': {
      put: {
        summary: 'Update Profile Photo',
        description: 'Update user profile photo',
        tags: ['Profile'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  profilePhoto: {
                    type: 'string',
                    format: 'binary',
                    description: 'Profile photo image file (jpeg, png, gif, webp) - max 5MB'
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Profile photo updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: {
                      type: 'object',
                      properties: {
                        profilePhoto: { type: 'string' },
                        profilePhotoUrl: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    // =======================
    // OTP AUTHENTICATION
    // =======================
    '/api/auth/email/register': {
      post: {
        summary: 'Request OTP for Registration',
        description: 'Send OTP to email for new user registration',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/OTPRegisterRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'OTP sent successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OTPResponse'
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/email/verify': {
      post: {
        summary: 'Verify OTP and Register',
        description: 'Verify OTP and create user',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/OTPVerifyRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'OTP verified and user created',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse'
                }
              }
            }
          },
          '400': {
            description: 'Invalid OTP or expired code',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/email/login': {
      post: {
        summary: 'Request OTP for Login',
        description: 'Send OTP to email for existing user login',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/OTPLoginRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'OTP sent successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/OTPResponse'
                }
              }
            }
          },
          '404': { description: 'User not found' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/email/verify-login': {
      post: {
        summary: 'Verify OTP for Login',
        description: 'Verify OTP and authenticate existing user',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/OTPVerifyLoginRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse'
                }
              }
            }
          },
          '400': { description: 'Invalid OTP or expired code' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    // =======================
    // PASSWORD RESET
    // =======================
    '/api/auth/forgot-password': {
      post: {
        summary: 'Forgot Password',
        description: 'Request password reset OTP',
        tags: ['Password Reset'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ForgotPasswordRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Reset OTP sent',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/reset-password': {
      post: {
        summary: 'Reset Password',
        description: 'Reset password using OTP. New password must be at least 8 characters.',
        tags: ['Password Reset'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ResetPasswordRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Password reset successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Bad request - password must be at least 8 characters',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                },
                example: {
                  success: false,
                  message: 'Password must be at least 8 characters long'
                }
              }
            }
          },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    // =======================
    // USER MANAGEMENT
    // =======================
    '/api/auth/profile': {
      get: {
        summary: 'Get User Profile',
        description: 'Get current user profile',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Profile retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/UserResponse' }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/status': {
      get: {
        summary: 'Check Authentication Status',
        description: 'Check if user is authenticated',
        tags: ['User Management'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Status retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    isAuthenticated: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/UserResponse' }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    // =======================
    // QUALITY ASSURANCE ENDPOINTS
    // =======================
    '/api/qa/upload-risk-data': {
      post: {
        summary: 'Upload Risk Data',
        description: 'Upload operational risk data file (QA role required)',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/RiskAssessmentUploadRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Risk data uploaded successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: { type: 'object' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/dashboard': {
      get: {
        summary: 'Get QA Dashboard',
        description: 'Get basic QA dashboard metrics',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Dashboard data retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'object' }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/dashboard-data': {
      get: {
        summary: 'Get Enhanced QA Dashboard',
        description: 'Get enhanced QA dashboard with charts and detailed metrics',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Enhanced dashboard data retrieved',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/QADashboardDataResponse'
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/risk-assessments': {
      get: {
        summary: 'Get Risk Assessments',
        description: 'Get all risk assessments with status counts',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Filter by status',
            schema: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
          },
          {
            name: 'department',
            in: 'query',
            description: 'Filter by department',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'Risk assessments retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/audit-plans': {
      get: {
        summary: 'Get Audit Plans',
        description: 'Get audit plans for consolidation',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Audit plans retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/consolidate-plans': {
      post: {
        summary: 'Consolidate Audit Plans',
        description: 'Consolidate multiple audit plans into one',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['planIds'],
                properties: {
                  planIds: {
                    type: 'array',
                    items: { type: 'string', format: 'uuid' },
                    description: 'Array of plan IDs to consolidate (minimum 2)'
                  },
                  consolidatedTitle: {
                    type: 'string',
                    description: 'Title for the consolidated plan'
                  },
                  description: {
                    type: 'string',
                    description: 'Description for the consolidated plan'
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Plans consolidated successfully' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/download-template': {
      get: {
        summary: 'Download Risk Template',
        description: 'Download risk data template',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Template downloaded',
            content: {
              'application/json': {
                schema: { type: 'object' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    // =======================
    // ADMIN ENDPOINTS
    // =======================
    '/api/auth/admin/create-user': {
      post: {
        summary: 'Create User with Role (Admin Only)',
        description: 'Create a new user with specific role. Password must be at least 8 characters if provided.',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AdminCreateUserRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'User created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: { $ref: '#/components/schemas/UserResponse' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/admin/users': {
      get: {
        summary: 'List All Users (Admin Only)',
        description: 'Get list of all users with filtering options',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'role',
            in: 'query',
            description: 'Filter by role',
            schema: { $ref: '#/components/schemas/UserRole' }
          },
          {
            name: 'department',
            in: 'query',
            description: 'Filter by department',
            schema: { type: 'string' }
          },
          {
            name: 'isActive',
            in: 'query',
            description: 'Filter by active status',
            schema: { type: 'boolean' }
          },
          {
            name: 'search',
            in: 'query',
            description: 'Search by name, email, or employee ID',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Users retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'integer' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/UserResponse' }
                    }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/admin/pending-users': {
      get: {
        summary: 'Get Pending Users (Admin Only)',
        description: 'Get users waiting for role assignment',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Pending users retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'integer' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/UserResponse' }
                    }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/admin/assign-role/{userId}': {
      put: {
        summary: 'Assign Role to User (Admin Only)',
        description: 'Assign role to a user',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            description: 'User UUID',
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { $ref: '#/components/schemas/UserRole' },
                  department: { type: 'string' },
                  employeeId: { type: 'string' },
                  reportsTo: { type: 'string', format: 'uuid' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Role assigned successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: { $ref: '#/components/schemas/UserResponse' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/admin/users/{id}': {
      get: {
        summary: 'Get User Details (Admin Only)',
        description: 'Get detailed user information including manager and subordinates',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        responses: {
          '200': {
            description: 'User details retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      allOf: [
                        { $ref: '#/components/schemas/UserResponse' },
                        {
                          type: 'object',
                          properties: {
                            manager: { $ref: '#/components/schemas/ManagerResponse' },
                            subordinates: {
                              type: 'array',
                              items: { $ref: '#/components/schemas/ManagerResponse' }
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      },
      put: {
        summary: 'Update User (Admin Only)',
        description: 'Update user details',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  role: { $ref: '#/components/schemas/UserRole' },
                  department: { type: 'string' },
                  employeeId: { type: 'string' },
                  reportsTo: { type: 'string', format: 'uuid' },
                  isActive: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'User updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' },
                    data: { $ref: '#/components/schemas/UserResponse' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      },
      delete: {
        summary: 'Deactivate User (Admin Only)',
        description: 'Deactivate a user account',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        responses: {
          '200': {
            description: 'User deactivated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/auth/admin/org-chart': {
      get: {
        summary: 'Get Organization Chart',
        description: 'Get hierarchical organization structure',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Organization chart retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          name: { type: 'string' },
                          role: { $ref: '#/components/schemas/UserRole' },
                          department: { type: 'string' },
                          subordinates: {
                            type: 'array',
                            items: { type: 'object' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    }
  }
};

const swaggerOptions = {
  explorer: true,
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: #2563eb; font-size: 24px; }
    .swagger-ui .btn.authorize { background-color: #2563eb; border-color: #2563eb; }
    .swagger-ui .scheme-container { background-color: #f8fafc; }
    .swagger-ui .info .description { font-size: 14px; line-height: 1.6; }
    .swagger-ui .model-box { background-color: #f9fafb; }
    .swagger-ui table { width: 100%; }
    .swagger-ui .opblock-tag { font-size: 18px; font-weight: bold; }
    .swagger-ui .opblock .opblock-summary-path { font-weight: bold; }
  `,
  customSiteTitle: "KovaPage Audit API Documentation",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    docExpansion: 'list',
    tagsSorter: 'alpha',
    operationsSorter: 'alpha'
  }
};

module.exports = {
  swaggerUi,
  swaggerDocument,
  swaggerOptions
};