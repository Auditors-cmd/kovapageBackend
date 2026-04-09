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

## File Storage
- **Cloudinary Integration**: All files (profile photos, risk data) stored in Cloudinary CDN
- **Profile Photos**: Automatically optimized and resized
- **Risk Data Files**: Excel, CSV, JSON files stored securely

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
      description: 'QA dashboard, risk assessment, and audit plan consolidation (Cloudinary storage)'
    },
    {
      name: 'Unit Head',
      description: 'Unit head dashboard metrics, actions, and performance trends'
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
            description: 'Profile photo image file (jpeg, png, gif, webp) - max 5MB. Uploaded to Cloudinary.'
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
              needsSelection: { type: 'boolean', example: false },
              roleSelectedAt: { type: 'string', format: 'date-time', nullable: true },
              assignmentManagedBy: { type: 'string', example: 'admin' },
              dashboard: { type: 'string', example: '/qa/dashboard' },
              profilePhotoUrl: { type: 'string', example: 'https://res.cloudinary.com/.../profile.jpg' }
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
            description: 'Profile photo image file (optional) - uploaded to Cloudinary'
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
          },
          photoPublicId: {
            type: 'string',
            example: 'kovapage/profiles/user-123-123456789',
            description: 'Cloudinary public ID from registration step (if photo was uploaded)'
          }
        },
        example: {
          email: 'auditor@company.com',
          name: 'John Auditor',
          otp: '123456',
          photoPublicId: 'kovapage/profiles/user-new-123456789'
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

      // Cloudinary File Info
      CloudinaryFileInfo: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Cloudinary public ID' },
          originalName: { type: 'string', description: 'Original file name' },
          url: { type: 'string', description: 'Cloudinary CDN URL', example: 'https://res.cloudinary.com/.../file.xlsx' },
          size: { type: 'integer', description: 'File size in bytes' },
          format: { type: 'string', description: 'File format' },
          resourceType: { type: 'string', enum: ['image', 'raw'], description: 'Cloudinary resource type' }
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
          riskData: { type: 'string', description: 'JSON string of risk data (optional)' },
          riskFile: {
            type: 'string',
            format: 'binary',
            description: 'Risk data file (Excel, JSON, or CSV) - uploaded to Cloudinary'
          }
        }
      },

      // NEW: Excel Upload Request Schema
      ExcelUploadRequest: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title for this risk assessment',
            example: 'Q1 Risk Assessment'
          },
          description: {
            type: 'string',
            description: 'Description of the assessment',
            example: 'Quarterly operational risk assessment'
          },
          department: {
            type: 'string',
            description: 'Department being assessed',
            example: 'Finance'
          },
          riskFile: {
            type: 'string',
            format: 'binary',
            description: 'Excel file (.xlsx or .xls) containing risk data'
          }
        }
      },

      // NEW: Excel Upload Response Schema
      ExcelUploadResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string' },
              summary: {
                type: 'object',
                properties: {
                  totalRisks: { type: 'integer' },
                  highRisk: { type: 'integer' },
                  mediumRisk: { type: 'integer' },
                  lowRisk: { type: 'integer' },
                  byUnit: { type: 'object' },
                  byCategory: { type: 'object' },
                  byStatus: { type: 'object' }
                }
              },
              fileUrl: { type: 'string' },
              rowCount: { type: 'integer' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      },

      RiskAssessmentResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          fileUrl: { type: 'string', description: 'Cloudinary URL' },
          cloudinaryPublicId: { type: 'string', description: 'Cloudinary public ID' },
          originalFileName: { type: 'string' },
          fileSize: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          createdBy: { type: 'object', properties: { name: { type: 'string' } } }
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
                  },
                  cloudinaryStorage: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', example: 'Files in Cloudinary' },
                      count: { type: 'integer' },
                      icon: { type: 'string', example: 'cloud' }
                    }
                  },
                  resourcesRequired: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', example: 'Resources Required' },
                      count: { type: 'integer' },
                      hours: { type: 'integer' },
                      icon: { type: 'string', example: 'team' }
                    }
                  },
                  budgetRequired: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', example: 'Budget Required' },
                      amount: { type: 'number' },
                      allocated: { type: 'number' },
                      currency: { type: 'string', example: 'NGN' },
                      icon: { type: 'string', example: 'currency' }
                    }
                  },
                  availableAuditors: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', example: 'Available Auditors' },
                      count: { type: 'integer' },
                      icon: { type: 'string', example: 'users' }
                    }
                  }
                }
              },
              comparisonTables: {
                type: 'object',
                properties: {
                  quarterAnalysis: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      subtitle: { type: 'string' },
                      priorYear: { type: 'integer' },
                      currentYear: { type: 'integer' },
                      rows: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            quarter: { type: 'string', example: 'Q1' },
                            priorYear: { type: 'integer' },
                            currentYear: { type: 'integer' },
                            variance: { type: 'integer' },
                            percentChange: { type: 'number', example: -25.0 }
                          }
                        }
                      },
                      totals: {
                        type: 'object',
                        properties: {
                          label: { type: 'string', example: 'Total' },
                          priorYear: { type: 'integer' },
                          currentYear: { type: 'integer' },
                          variance: { type: 'integer' },
                          percentChange: { type: 'number', example: 12.5 }
                        }
                      }
                    }
                  },
                  unitYtdAnalysis: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      subtitle: { type: 'string' },
                      priorYear: { type: 'integer' },
                      currentYear: { type: 'integer' },
                      rows: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            businessUnit: { type: 'string', example: 'Financial Crime' },
                            priorYtd: { type: 'integer' },
                            currentYtd: { type: 'integer' },
                            variance: { type: 'integer' },
                            percentChange: { type: 'number', example: 100.0 }
                          }
                        }
                      },
                      totals: {
                        type: 'object',
                        properties: {
                          label: { type: 'string', example: 'Total' },
                          priorYtd: { type: 'integer' },
                          currentYtd: { type: 'integer' },
                          variance: { type: 'integer' },
                          percentChange: { type: 'number', example: 10.0 }
                        }
                      }
                    }
                  }
                }
              },
              executiveSummary: {
                type: 'object',
                properties: {
                  totalAudits: { type: 'integer' },
                  resourcesRequired: { type: 'integer' },
                  resourceHoursRequired: { type: 'integer' },
                  availableAuditors: { type: 'integer' },
                  budgetRequired: { type: 'number' },
                  budgetAllocated: { type: 'number' },
                  budgetCurrency: { type: 'string', example: 'NGN' }
                }
              },
              summary: {
                type: 'object',
                properties: {
                  totalAudits: { type: 'integer' },
                  pendingReviews: { type: 'integer' },
                  completedThisYear: { type: 'integer' },
                  totalCloudinaryFiles: { type: 'integer' },
                  resourcesRequired: { type: 'integer' },
                  resourceHoursRequired: { type: 'integer' },
                  availableAuditors: { type: 'integer' },
                  budgetRequired: { type: 'number' },
                  budgetAllocated: { type: 'number' },
                  budgetCurrency: { type: 'string', example: 'NGN' }
                }
              }
            }
          }
        }
      },

      // User Response with all fields including Cloudinary
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
          profilePhotoPublicId: {
            type: 'string',
            description: 'Cloudinary public ID for profile photo'
          },
          profilePhotoUrl: {
            type: 'string',
            description: 'Cloudinary CDN URL for profile photo',
            example: 'https://res.cloudinary.com/.../profile.jpg'
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
          profilePhotoPublicId: 'kovapage/profiles/user-123-123456789',
          profilePhotoUrl: 'https://res.cloudinary.com/demo/image/upload/kovapage/profiles/user-123-123456789.jpg',
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
          },
          profilePhotoUrl: {
            type: 'string',
            description: 'Cloudinary profile photo URL'
          }
        },
        example: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'John Chief',
          email: 'john.chief@company.com',
          role: 'chief_audit_executive',
          department: 'Executive',
          profilePhotoUrl: 'https://res.cloudinary.com/.../profile.jpg'
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
              },
              photoPublicId: {
                type: 'string',
                description: 'Cloudinary public ID if photo was uploaded'
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
            hasProfilePhoto: true,
            photoPublicId: 'kovapage/profiles/user-new-123456789'
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

    // HEALTH & TEST ENDPOINTS
  
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

    '/api/auth/bootstrap/admin': {
      post: {
        summary: 'Bootstrap Initial Admin Account',
        description: 'Creates the first BAC or CAE account. This endpoint is protected by the x-bootstrap-key header and is locked once an active BAC/CAE account exists.',
        tags: ['Authentication'],
        parameters: [
          {
            in: 'header',
            name: 'x-bootstrap-key',
            required: true,
            schema: {
              type: 'string'
            },
            description: 'Bootstrap key from ADMIN_BOOTSTRAP_KEY environment variable'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password', 'role'],
                properties: {
                  name: { type: 'string', example: 'System Admin' },
                  email: { type: 'string', format: 'email', example: 'admin@company.com' },
                  password: { type: 'string', minLength: 8, example: 'StrongPass123!' },
                  role: {
                    type: 'string',
                    enum: ['bac_secretariat', 'chief_audit_executive'],
                    example: 'chief_audit_executive'
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Bootstrap admin created successfully'
          },
          '400': {
            description: 'Validation error or user already exists'
          },
          '401': {
            description: 'Invalid bootstrap key'
          },
          '403': {
            description: 'Bootstrap feature disabled'
          },
          '409': {
            description: 'Bootstrap locked because admin already exists'
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
                      profilePhotoUrl: 'https://res.cloudinary.com/.../profile.jpg',
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
    // PROFILE MANAGEMENT (Cloudinary)
    // =======================
    '/api/auth/update-photo': {
      put: {
        summary: 'Update Profile Photo (Cloudinary)',
        description: 'Update user profile photo. Uploads to Cloudinary and automatically deletes old photo.',
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
                    description: 'Profile photo image file (jpeg, png, gif, webp) - max 5MB. Uploaded to Cloudinary.'
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
                        profilePhotoUrl: { type: 'string', example: 'https://res.cloudinary.com/.../profile.jpg' }
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

    '/api/auth/delete-photo': {
      delete: {
        summary: 'Delete Profile Photo',
        description: 'Delete user profile photo from Cloudinary',
        tags: ['Profile'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Profile photo deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Profile photo deleted successfully' }
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
    // OTP AUTHENTICATION
    // =======================
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

    
    // PASSWORD RESET

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

    
    // USER MANAGEMENT
    
    '/api/auth/profile': {
      get: {
        summary: 'Get User Profile',
        description: 'Get current user profile with Cloudinary photo URL',
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
    // QUALITY ASSURANCE ENDPOINTS (Cloudinary)
    // =======================
    '/api/qa/upload-risk-data': {
      post: {
        summary: 'Upload Risk Data to Cloudinary',
        description: 'Upload operational risk data file to Cloudinary (QA role required). Supports Excel, CSV, and JSON files.',
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
            description: 'Risk data uploaded successfully to Cloudinary',
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
                        title: { type: 'string' },
                        fileUrl: { type: 'string', example: 'https://res.cloudinary.com/.../file.xlsx' },
                        cloudinaryPublicId: { type: 'string' }
                      }
                    }
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

    // NEW: Excel Upload Endpoint
    '/api/qa/upload-risk-excel': {
      post: {
        summary: 'Upload and Validate Excel Risk Data',
        description: 'Upload an Excel file with risk data. Validates format, calculates risk levels (High/Medium/Low), and stores in database with detailed summaries.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                $ref: '#/components/schemas/ExcelUploadRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Excel file processed and validated successfully',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ExcelUploadResponse'
                }
              }
            }
          },
          '400': {
            description: 'Validation failed - check error details for specific rows',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Validation failed' },
                    errors: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          row: { type: 'integer' },
                          errors: { type: 'array', items: { type: 'string' } }
                        }
                      }
                    },
                    summary: {
                      type: 'object',
                      properties: {
                        totalRows: { type: 'integer' },
                        validRows: { type: 'integer' },
                        errorRows: { type: 'integer' }
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
    },

    '/api/qa/risk-assessments': {
      get: {
        summary: 'Get Risk Assessments',
        description: 'Get all risk assessments with status counts and Cloudinary file URLs',
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
          '200': {
            description: 'Risk assessments retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/RiskAssessmentResponse' }
                    },
                    summary: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        pending: { type: 'integer' },
                        inProgress: { type: 'integer' },
                        completed: { type: 'integer' }
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
    },

    '/api/qa/risk-assessments/{id}': {
      delete: {
        summary: 'Delete Risk Assessment',
        description: 'Delete risk assessment and its associated file from Cloudinary',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Risk assessment ID',
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        responses: {
          '200': {
            description: 'Risk assessment deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Risk assessment deleted successfully' }
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

    '/api/qa/risk-assessments/{id}/status': {
      put: {
        summary: 'Update Risk Assessment Status',
        description: 'Update risk assessment status',
        tags: ['Quality Assurance'],
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
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed']
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Status updated' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/dashboard': {
      get: {
        summary: 'Get QA Dashboard',
        description: 'Get basic QA dashboard metrics with Cloudinary file counts',
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
        description: 'Get enhanced QA dashboard with charts, metrics, and Cloudinary storage stats',
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

    '/api/unit-head/dashboard-data': {
      get: {
        summary: 'Get Unit Head Dashboard Data',
        description: 'Returns unit-scoped summary cards, action counts, menu counts, and chart datasets for the Unit Head dashboard.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'department',
            in: 'query',
            required: false,
            description: 'Optional department override for roles above unit_head',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Unit head dashboard data retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        scope: {
                          type: 'object',
                          properties: {
                            department: { type: 'string', nullable: true },
                            scopedByRole: { type: 'boolean' }
                          }
                        },
                        summaryCards: {
                          type: 'object'
                        },
                        actions: {
                          type: 'object'
                        },
                        menuCounts: {
                          type: 'object'
                        },
                        charts: {
                          type: 'object'
                        },
                        statusSummary: {
                          type: 'object'
                        },
                        recent: {
                          type: 'object'
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
    },

    '/api/unit-head/approved-plan-data': {
      get: {
        summary: 'Get Approved Plan Screen Data',
        description: 'Returns Unit Head approved-plan overview, audit execution status counts, chart data, approved plan rows, and assignment pool/actions.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'department',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Optional department override for roles above unit_head'
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['ongoing', 'not_started', 'completed'] },
            description: 'Optional filter by derived execution status'
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Optional search by plan title, plan number, or unit name'
          }
        ],
        responses: {
          '200': {
            description: 'Approved plan screen data retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        scope: {
                          type: 'object',
                          properties: {
                            department: { type: 'string', nullable: true }
                          }
                        },
                        approvedPlanOverview: { type: 'object' },
                        auditStatusOverview: { type: 'object' },
                        approvedPlans: { type: 'object' },
                        assignmentPool: { type: 'object' }
                      }
                    }
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

    '/api/unit-head/approved-plan/{id}/assign': {
      post: {
        summary: 'Assign Approved Plan',
        description: 'Assigns an approved/consolidated/implemented plan to a team lead and team members, optionally updates execution status/progress, and creates assignment tasks + unread notifications for assignees.',
        tags: ['Unit Head'],
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
                  teamLeadId: { type: 'string', format: 'uuid', nullable: true },
                  teamMemberIds: {
                    type: 'array',
                    items: { type: 'string', format: 'uuid' }
                  },
                  executionStatus: {
                    type: 'string',
                    enum: ['not_started', 'ongoing', 'completed']
                  },
                  progressPercentage: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100
                  },
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Approved plan assignment updated successfully' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/auto-schedule/recommendations': {
      get: {
        summary: 'Generate Auto-Schedule Recommendations',
        description: 'Recommendation-only endpoint that suggests next-year audit schedule after at least one year of approved/consolidated/implemented history. Final approval is still required.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'targetYear',
            in: 'query',
            required: false,
            schema: { type: 'integer', example: 2027 },
            description: 'Year to generate schedule recommendations for. Defaults to next year.'
          },
          {
            name: 'department',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Optional department override for roles above unit_head'
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, example: 50 },
            description: 'Max recommendation rows to return'
          }
        ],
        responses: {
          '200': { description: 'Auto-schedule recommendations generated' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/draft-plan-review-data': {
      get: {
        summary: 'Get Draft Plan Review Screen Data',
        description: 'Returns resource/budget summary and system-generated draft plan rows for Unit Head Draft Plan Review screen.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'apmStatus',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'rejected'] }
          },
          {
            name: 'department',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'Draft plan review data retrieved' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/risk-assessments': {
      get: {
        summary: 'List Unit Risk Assessments',
        description: 'Returns unit risk rows for score finalization table (Risk Assessment screen).',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'includeSubmitted',
            in: 'query',
            required: false,
            schema: { type: 'boolean', example: false }
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'reviewed'] }
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'Risk rows retrieved' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/risk-assessments/{id}/finalization': {
      put: {
        summary: 'Update Risk Finalization Row',
        description: 'Updates one row in the Unit Head risk finalization table.',
        tags: ['Unit Head'],
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
                  unitName: { type: 'string' },
                  retailOperations: { type: 'string' },
                  branchAudit: { type: 'string' },
                  operationalRiskScoreY: { type: 'number', minimum: 0, maximum: 100 },
                  riskRating: { type: 'string', enum: ['Very High', 'High', 'Medium', 'Low', 'Very Low'] },
                  currentAuditScore: { type: 'number', minimum: 0, maximum: 100 },
                  currentCycleTag: { type: 'string', example: 'AUTO 2026 Q1' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Risk finalization row updated' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/risk-assessments/save-draft': {
      post: {
        summary: 'Save Risk Finalization Draft',
        description: 'Bulk save risk finalization rows as draft.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['rows'],
                properties: {
                  notes: { type: 'string' },
                  rows: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id'],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        unitName: { type: 'string' },
                        retailOperations: { type: 'string' },
                        branchAudit: { type: 'string' },
                        operationalRiskScoreY: { type: 'number' },
                        riskRating: { type: 'string' },
                        currentAuditScore: { type: 'number' },
                        currentCycleTag: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Draft saved successfully' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/risk-assessments/submit-to-qa': {
      post: {
        summary: 'Submit Finalized Risks to QA',
        description: 'Bulk submit finalized unit risk rows to QA.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  assessmentIds: {
                    type: 'array',
                    items: { type: 'string', format: 'uuid' }
                  },
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Risk rows submitted to QA' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/apm': {
      get: {
        summary: 'List APMs',
        description: 'Get Audit Program Memorandums scoped to the unit head department.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'apmStatus',
            in: 'query',
            schema: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'rejected'] }
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['draft', 'under_review', 'approved', 'consolidated', 'implemented'] }
          }
        ],
        responses: {
          '200': { description: 'APM list retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      },
      post: {
        summary: 'Create New APM',
        description: 'Create a new audit program memorandum draft, with optional immediate submission for approval.',
        tags: ['Unit Head'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', example: 'Q2 Operational Audit APM' },
                  description: { type: 'string' },
                  department: { type: 'string', description: 'Optional for roles above unit_head' },
                  planNumber: { type: 'string' },
                  auditPeriod: { type: 'string', example: 'Q2 2026' },
                  startDate: { type: 'string', format: 'date-time' },
                  endDate: { type: 'string', format: 'date-time' },
                  budget: { type: 'number' },
                  resourceHours: { type: 'integer' },
                  auditAreas: { type: 'array', items: { type: 'string' } },
                  riskAssessmentId: { type: 'string', format: 'uuid' },
                  teamLeadId: { type: 'string', format: 'uuid' },
                  teamMemberIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  objectives: { type: 'array', items: { type: 'string' } },
                  scope: { type: 'string' },
                  deliverables: { type: 'array', items: { type: 'string' } },
                  notes: { type: 'string' },
                  submitForApproval: { type: 'boolean', example: false }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'APM created successfully' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/apm/{id}': {
      get: {
        summary: 'Get APM Details',
        description: 'Get full details of a single audit program memorandum.',
        tags: ['Unit Head'],
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
          '200': { description: 'APM retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      },
      put: {
        summary: 'Update APM Draft',
        description: 'Update APM details while it is not pending approval.',
        tags: ['Unit Head'],
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
                  title: { type: 'string' },
                  description: { type: 'string' },
                  auditPeriod: { type: 'string' },
                  startDate: { type: 'string', format: 'date-time' },
                  endDate: { type: 'string', format: 'date-time' },
                  budget: { type: 'number' },
                  resourceHours: { type: 'integer' },
                  auditAreas: { type: 'array', items: { type: 'string' } },
                  riskAssessmentId: { type: 'string', format: 'uuid' },
                  teamLeadId: { type: 'string', format: 'uuid' },
                  teamMemberIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  objectives: { type: 'array', items: { type: 'string' } },
                  scope: { type: 'string' },
                  deliverables: { type: 'array', items: { type: 'string' } },
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'APM updated successfully' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/apm/{id}/submit': {
      post: {
        summary: 'Submit APM for Approval',
        description: 'Marks an APM as pending approval and moves plan status to under_review.',
        tags: ['Unit Head'],
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
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'APM submitted for approval' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/apm/{id}/approve': {
      post: {
        summary: 'Approve APM',
        description: 'Approves a draft/pending APM and submits it to Quality Assurance for consolidation.',
        tags: ['Unit Head'],
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
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'APM approved and submitted to QA for consolidation' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/unit-head/apm/{id}/reject': {
      post: {
        summary: 'Reject APM',
        description: 'Rejects an APM that is currently pending approval and returns it to draft.',
        tags: ['Unit Head'],
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
                required: ['reason'],
                properties: {
                  reason: { type: 'string', example: 'Scope needs to be narrowed to Q2' },
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'APM rejected and returned to draft' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/audit-plans': {
      get: {
        summary: 'Get Audit Plans',
        description: 'Get audit plans for consolidation with Cloudinary file references',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Filter by status',
            schema: { type: 'string' }
          },
          {
            name: 'department',
            in: 'query',
            description: 'Filter by department',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Audit plans retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { type: 'object' }
                    },
                    summary: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        pendingReview: { type: 'integer' },
                        readyForConsolidation: { type: 'integer' },
                        submittedToCae: { type: 'integer' }
                      }
                    },
                    planDashboard: {
                      type: 'object',
                      properties: {
                        quarterlyDistribution: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              quarter: { type: 'string', example: 'Q2' },
                              auditsScheduled: { type: 'integer' },
                              resources: { type: 'integer' },
                              availableAuditors: { type: 'integer' },
                              capacityPercent: { type: 'number', example: 5.0 }
                            }
                          }
                        },
                        consolidatedAuditPlan: {
                          type: 'object',
                          properties: {
                            unitsReadyForCaeReview: { type: 'integer' },
                            rows: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  id: { type: 'string', format: 'uuid' },
                                  unitName: { type: 'string', example: 'Financial Crime' },
                                  operationalRiskScore: { type: 'integer', example: 90 },
                                  riskRating: { type: 'string', example: 'Medium' },
                                  frequency: { type: 'string', example: 'Annual' },
                                  quarter: { type: 'string', example: 'Q2' },
                                  resources: { type: 'integer', example: 5 },
                                  budget: { type: 'number', example: 3600000 },
                                  status: { type: 'string', example: 'approved' }
                                }
                              }
                            },
                            totals: {
                              type: 'object',
                              properties: {
                                resources: { type: 'integer' },
                                budget: { type: 'number' }
                              }
                            }
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
    },

    '/api/qa/audit-plans/export-excel': {
      get: {
        summary: 'Export Consolidated Audit Plan to Excel',
        description: 'Download quarterly distribution and consolidated audit plan as an Excel file.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Optional status filter',
            schema: { type: 'string' }
          },
          {
            name: 'department',
            in: 'query',
            description: 'Optional department filter',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Excel file exported',
            content: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                schema: { type: 'string', format: 'binary' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/audit-plans/{id}/score': {
      put: {
        summary: 'Update Consolidated Plan Risk Score',
        description: 'Supports the Edit Score action by storing manual risk score and rating on plan metadata.',
        tags: ['Quality Assurance'],
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
                required: ['operationalRiskScore'],
                properties: {
                  operationalRiskScore: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100
                  },
                  riskRating: {
                    type: 'string',
                    enum: ['High', 'Medium', 'Low']
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Risk score updated' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/audit-plans/export-pdf': {
      get: {
        summary: 'Export Consolidated Audit Plan to PDF',
        description: 'Download quarterly distribution and consolidated audit plan as a PDF file.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            description: 'Optional status filter',
            schema: { type: 'string' }
          },
          {
            name: 'department',
            in: 'query',
            description: 'Optional department filter',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'PDF file exported',
            content: {
              'application/pdf': {
                schema: { type: 'string', format: 'binary' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/auto-schedule/recommendations': {
      get: {
        summary: 'Get QA Auto-Schedule Recommendations',
        description: 'Returns cross-unit next-year audit schedule recommendations based on at least one year of approved/consolidated/implemented history. Recommendation-only; approval required.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'targetYear',
            in: 'query',
            required: false,
            schema: { type: 'integer', example: 2027 }
          },
          {
            name: 'department',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, example: 100 }
          }
        ],
        responses: {
          '200': { description: 'Auto-schedule recommendations retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/auto-schedule/submissions': {
      get: {
        summary: 'List QA Auto-Schedule Submissions',
        description: 'Returns auto-schedule submissions prepared by QA for CAE decision.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['pending_approval', 'approved', 'rejected'] }
          },
          {
            name: 'targetYear',
            in: 'query',
            required: false,
            schema: { type: 'integer' }
          },
          {
            name: 'department',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'Auto-schedule submissions retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/auto-schedule/submit-to-cae': {
      post: {
        summary: 'Submit Auto-Schedule Recommendations to CAE',
        description: 'Creates an auto-schedule submission package and notifies CAE users for approval decision.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sourcePlanIds: {
                    type: 'array',
                    items: { type: 'string', format: 'uuid' },
                    description: 'Optional explicit source plan IDs; if omitted, all eligible plans are considered'
                  },
                  targetYear: {
                    type: 'integer',
                    example: 2027
                  },
                  department: {
                    type: 'string'
                  },
                  notes: {
                    type: 'string'
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Auto-schedule recommendations submitted to CAE' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/qa/submit-to-cae': {
      post: {
        summary: 'Submit Audit Plans to CAE',
        description: 'Submit approved plans (or selected plan IDs) to CAE and store submission metadata.',
        tags: ['Quality Assurance'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  planIds: {
                    type: 'array',
                    items: { type: 'string', format: 'uuid' },
                    description: 'Optional explicit plan IDs to submit'
                  },
                  status: {
                    type: 'string',
                    example: 'approved',
                    description: 'Optional status filter (default: approved)'
                  },
                  department: {
                    type: 'string',
                    description: 'Optional department filter'
                  },
                  notes: {
                    type: 'string',
                    description: 'Optional submission note'
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Plans submitted to CAE',
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
                        submissionId: { type: 'string' },
                        submittedCount: { type: 'integer' },
                        submittedAt: { type: 'string', format: 'date-time' },
                        planIds: {
                          type: 'array',
                          items: { type: 'string', format: 'uuid' }
                        }
                      }
                    }
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

    '/api/qa/consolidate-plans': {
      post: {
        summary: 'Consolidate Audit Plans',
        description: 'Consolidate multiple audit plans into one, preserving Cloudinary file references',
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
        description: 'Download risk data template (JSON format)',
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

    '/api/cae/auto-schedule/submissions': {
      get: {
        summary: 'List CAE Auto-Schedule Submissions',
        description: 'CAE view of pending/approved/rejected auto-schedule submissions.',
        tags: ['Chief Audit Executive'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['pending_approval', 'approved', 'rejected'] }
          },
          {
            name: 'targetYear',
            in: 'query',
            required: false,
            schema: { type: 'integer' }
          },
          {
            name: 'department',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'CAE auto-schedule submissions retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/cae/auto-schedule/submissions/{submissionId}': {
      get: {
        summary: 'Get CAE Auto-Schedule Submission',
        description: 'Get one auto-schedule submission by submissionId.',
        tags: ['Chief Audit Executive'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'submissionId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'Auto-schedule submission retrieved' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/cae/auto-schedule/{submissionId}/approve': {
      post: {
        summary: 'Approve Auto-Schedule Submission',
        description: 'CAE approves a pending auto-schedule recommendation package.',
        tags: ['Chief Audit Executive'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'submissionId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Auto-schedule submission approved' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '500': { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/api/cae/auto-schedule/{submissionId}/reject': {
      post: {
        summary: 'Reject Auto-Schedule Submission',
        description: 'CAE rejects a pending auto-schedule recommendation package.',
        tags: ['Chief Audit Executive'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'submissionId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string', example: 'Risk rationale is incomplete for two units.' },
                  notes: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Auto-schedule submission rejected' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
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
        description: 'Create a new OTP-based user with a specific role. Password is not accepted by this endpoint.',
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
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
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
        description: 'Soft-deactivate a user account by setting isActive=false',
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
          '400': { $ref: '#/components/responses/BadRequest' },
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
        description: 'Get hierarchical organization structure based on reportsTo relationships. Active users only by default.',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'includeInactive',
            in: 'query',
            description: 'Include inactive users in org chart (default: false)',
            schema: { type: 'boolean', default: false }
          }
        ],
        responses: {
          '200': {
            description: 'Organization chart retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    meta: {
                      type: 'object',
                      properties: {
                        includeInactive: { type: 'boolean', example: false },
                        totalUsers: { type: 'integer', example: 12 }
                      }
                    },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          name: { type: 'string' },
                          email: { type: 'string', format: 'email' },
                          role: { $ref: '#/components/schemas/UserRole' },
                          department: { type: 'string' },
                          profilePhotoUrl: { type: 'string' },
                          isActive: { type: 'boolean' },
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

const ensureSwaggerTag = (name, description) => {
  if (!swaggerDocument.tags.some((tag) => tag.name === name)) {
    swaggerDocument.tags.push({ name, description });
  }
};

ensureSwaggerTag('Audit Operations', 'Assignment, governance document, and review operations for audit teams');
ensureSwaggerTag('Auditee', 'Auditee dashboard, uploads, comments, and governance document endpoints');
ensureSwaggerTag('Team Lead', 'Team Lead dashboard and approved audit plan endpoints');
ensureSwaggerTag('Annual Audit Plans', 'Document-style annual audit plan lifecycle, sections, approvals, and exports');
ensureSwaggerTag('Chief Audit Executive', 'Chief Audit Executive review and decision endpoints');

Object.assign(swaggerDocument.components.schemas, {
  AssignmentProcedure: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'procedure-1' },
      title: { type: 'string', example: 'Review access controls' },
      description: { type: 'string', nullable: true },
      area: { type: 'string', example: 'Area 1' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'submitted'] },
      completionPercentage: { type: 'integer', example: 55 },
      workingNotes: { type: 'string', nullable: true },
      evidenceSummary: { type: 'string', nullable: true }
    }
  },
  AuditAssignmentTaskResponse: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      assignmentRole: { type: 'string', enum: ['team_lead', 'team_member'] },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'reassigned'] },
      dueDate: { type: 'string', format: 'date-time', nullable: true },
      auditPlan: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          planNumber: { type: 'string' },
          title: { type: 'string' },
          department: { type: 'string', nullable: true }
        }
      },
      procedureSummary: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          pending: { type: 'integer' },
          inProgress: { type: 'integer' },
          completed: { type: 'integer' },
          blocked: { type: 'integer' },
          averageCompletion: { type: 'integer' }
        }
      },
      procedures: {
        type: 'array',
        items: { $ref: '#/components/schemas/AssignmentProcedure' }
      }
    }
  },
  DocumentRequestPayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      requestNumber: { type: 'string', example: 'DR-1775538916279-567' },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      category: { type: 'string', example: 'governance' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      status: { type: 'string', enum: ['pending_upload', 'uploaded', 'under_review', 'approved', 'rejected', 'overdue', 'cancelled'] },
      recipientEmail: { type: 'string', format: 'email', nullable: true },
      folderName: { type: 'string', nullable: true },
      folderKey: { type: 'string', nullable: true },
      requestedItems: { type: 'array', items: { type: 'object' } }
    }
  },
  GovernanceDocumentPayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      folderName: { type: 'string', nullable: true },
      folderKey: { type: 'string', nullable: true },
      fileUrl: { type: 'string' },
      originalFileName: { type: 'string' },
      versionNumber: { type: 'integer' }
    }
  },
  DocumentCommentPayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      body: { type: 'string' },
      visibility: { type: 'string', enum: ['internal', 'shared'] },
      createdAt: { type: 'string', format: 'date-time' }
    }
  },
  AuditNotificationPayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      notificationType: { type: 'string', enum: ['opening_meeting', 'closing_meeting', 'fieldwork_notice', 'document_deadline', 'general'] },
      badgeLabel: { type: 'string' },
      scheduledAt: { type: 'string', format: 'date-time' },
      locationOrMode: { type: 'string', nullable: true },
      message: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['scheduled', 'cancelled', 'completed'] },
      responseStatus: { type: 'string', enum: ['pending', 'confirmed', 'change_requested', 'declined'] }
    }
  },
  TeamLeadApprovedPlanPayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      planNumber: { type: 'string' },
      title: { type: 'string' },
      businessUnit: { type: 'string' },
      riskRating: { type: 'string', enum: ['Very High', 'High', 'Medium', 'Low', 'Very Low'] },
      quarters: { type: 'array', items: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] } },
      executionStatus: { type: 'string', enum: ['not_started', 'ongoing', 'completed'] },
      progressPercentage: { type: 'number' },
      teamMemberCount: { type: 'integer' }
    }
  },
  QaApmReviewSummary: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      apmId: { type: 'string', example: 'APM-2026-001' },
      auditTitle: { type: 'string', example: 'Financial Crime Review' },
      unitName: { type: 'string', example: 'Financial Crime' },
      submittedBy: { type: 'string', nullable: true },
      team: { type: 'string', nullable: true },
      submittedDate: { type: 'string', format: 'date-time', nullable: true },
      duration: { type: 'integer', example: 30 },
      auditClassification: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['pending', 'approved', 'needs_revision', 'draft'] },
      statusLabel: { type: 'string', example: 'Pending' },
      latestReviewComment: { type: 'string', nullable: true }
    }
  },
  QaPlanReviewPayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      planNumber: { type: 'string', example: 'EP-PLAN-123' },
      title: { type: 'string' },
      unitName: { type: 'string' },
      status: { type: 'string' },
      qaReviewStatus: { type: 'string', nullable: true },
      latestComment: { type: 'object', nullable: true },
      latestModificationRequest: { type: 'object', nullable: true },
      commentHistory: { type: 'array', items: { type: 'object' } },
      modificationHistory: { type: 'array', items: { type: 'object' } },
      caeSubmission: { type: 'object', nullable: true },
      caeDecision: { type: 'object', nullable: true }
    }
  },
  HistoricalRiskScorePayload: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      unitName: { type: 'string', example: 'Financial Crime' },
      classification: { type: 'string', nullable: true },
      auditResponsibleUnit: { type: 'string', nullable: true },
      operationalRiskScore: { type: 'number', nullable: true, example: 90 },
      riskRating: { type: 'string', nullable: true, example: 'Very High' },
      currentAuditScore: { type: 'number', nullable: true, example: 20 },
      auditPeriod: { type: 'string', nullable: true, example: 'FY 2024 Q3' },
      sourceYear: { type: 'integer', nullable: true, example: 2024 },
      sourceQuarter: { type: 'string', nullable: true, example: 'Q3' },
      batchId: { type: 'string', nullable: true },
      originalFileName: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true }
    }
  },
  QaApmReviewDetail: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'APM-2026-001' },
      planId: { type: 'string', format: 'uuid' },
      submittedBy: { type: 'string', nullable: true },
      submittedDate: { type: 'string', format: 'date-time', nullable: true },
      team: { type: 'string', nullable: true },
      auditTitle: { type: 'string', example: 'Financial Crime Review' },
      auditClassification: { type: 'string', nullable: true, example: 'Compliance' },
      duration: { type: 'integer', example: 30 },
      unitBackground: { type: 'string', nullable: true },
      objectives: { type: 'array', items: { type: 'string' } },
      scopeOfReview: { type: 'string', nullable: true },
      riskAnalysis: { type: 'string', nullable: true },
      controlAnalysis: { type: 'string', nullable: true },
      auditApproach: { type: 'string', nullable: true },
      auditProcess: { type: 'array', items: { type: 'object' } },
      testProcedures: { type: 'array', items: { type: 'object' } },
      status: { type: 'string', enum: ['pending', 'approved', 'needs_revision', 'draft'] },
      comments: { type: 'array', items: { type: 'object' } }
    }
  },
  QaReportReviewRow: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      planNumber: { type: 'string', example: 'QA-REG-1775720548954-1' },
      title: { type: 'string', example: 'Endpoint QA Approved Plan One 1775720548954' },
      unitName: { type: 'string', example: 'Endpoint QA Narrow 1775720548954' },
      workflowStatus: { type: 'string', example: 'approved' },
      riskRating: { type: 'string', example: 'Medium' },
      submittedToCaeAt: { type: 'string', format: 'date-time', nullable: true },
      caeDecisionStatus: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
      caeDecisionAt: { type: 'string', format: 'date-time', nullable: true },
      latestQaComment: { type: 'string', nullable: true }
    }
  },
  QaSurveyDepartmentRow: {
    type: 'object',
    properties: {
      department: { type: 'string', example: 'Financial Crime' },
      planCount: { type: 'integer', example: 3 },
      averageRiskScore: { type: 'number', example: 74.5 }
    }
  },
  QaHistoryEvent: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'qa-plan-comment-1775720760816-82148' },
      sourceType: { type: 'string', example: 'audit_plan' },
      auditPlanId: { type: 'string', format: 'uuid', nullable: true },
      riskAssessmentId: { type: 'string', format: 'uuid', nullable: true },
      planNumber: { type: 'string', nullable: true },
      title: { type: 'string', example: 'Endpoint QA Approved Plan One 1775720548954' },
      unitName: { type: 'string', example: 'Endpoint QA Narrow 1775720548954' },
      eventType: { type: 'string', example: 'qa_comment' },
      description: { type: 'string', example: 'Focused QA regression comment.' },
      timestamp: { type: 'string', format: 'date-time' },
      actorName: { type: 'string', nullable: true }
    }
  },
  CaeMasterPlanPlanRow: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      planNumber: { type: 'string', example: 'QA-REG-1775720548954-1' },
      title: { type: 'string' },
      unitName: { type: 'string' },
      workflowStatus: { type: 'string' },
      operationalRiskScore: { type: 'integer', example: 67 },
      riskRating: { type: 'string', example: 'Medium' },
      detailedRiskRating: { type: 'string', example: 'Medium' },
      frequency: { type: 'string', example: 'Annual' },
      plannedQuarters: { type: 'array', items: { type: 'string', example: 'Q2' } },
      resources: { type: 'integer', example: 2 },
      budget: { type: 'number', example: 4200 },
      resourceHours: { type: 'integer', example: 100 },
      submittedAt: { type: 'string', format: 'date-time', nullable: true },
      submittedByName: { type: 'string', nullable: true },
      decisionStatus: { type: 'string', enum: ['pending', 'approved', 'rejected', 'modification_requested'] },
      decisionAt: { type: 'string', format: 'date-time', nullable: true }
    }
  },
  CaeMasterPlanSubmission: {
    type: 'object',
    properties: {
      submissionId: { type: 'string', example: 'CAE-1775720842561-984' },
      submittedAt: { type: 'string', format: 'date-time', nullable: true },
      submittedBy: { type: 'string', format: 'uuid', nullable: true },
      submittedByName: { type: 'string', nullable: true, example: 'Endpoint QA Reviewer' },
      notes: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'modification_requested'] },
      decidedAt: { type: 'string', format: 'date-time', nullable: true },
      planCount: { type: 'integer', example: 1 },
      plans: { type: 'array', items: { $ref: '#/components/schemas/CaeMasterPlanPlanRow' } }
    }
  },
  CaeApmSummaryRow: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      apmId: { type: 'string', example: 'CAE-APM-1775720548954-A' },
      auditTitle: { type: 'string' },
      unitName: { type: 'string' },
      submittedBy: { type: 'string', nullable: true },
      team: { type: 'string', nullable: true },
      submittedDate: { type: 'string', format: 'date-time', nullable: true },
      duration: { type: 'integer', example: 20 },
      auditClassification: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['pending', 'approved', 'needs_revision', 'draft'] },
      statusLabel: { type: 'string', example: 'Pending' },
      latestReviewComment: { type: 'string', nullable: true }
    }
  },
  CaeBoardSubmissionRow: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      planNumber: { type: 'string', example: 'ANNUAL-CAE-1775720548954' },
      title: { type: 'string' },
      year: { type: 'integer', example: 2026 },
      status: { type: 'string', enum: ['cae_approved', 'board_pending', 'board_approved', 'board_rejected', 'published'] },
      sectionCount: { type: 'integer', example: 1 },
      rowCount: { type: 'integer', example: 2 },
      totalAudits: { type: 'integer', example: 2 },
      submittedToBoardAt: { type: 'string', format: 'date-time', nullable: true },
      approvedAt: { type: 'string', format: 'date-time', nullable: true },
      publishedAt: { type: 'string', format: 'date-time', nullable: true },
      latestAction: { type: 'string', nullable: true },
      latestActionAt: { type: 'string', format: 'date-time', nullable: true }
    }
  }
});

Object.assign(swaggerDocument.paths, {
  '/api/audit/dashboard': {
    get: {
      summary: 'Get audit operations dashboard',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Dashboard retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/audit/my-audits': {
    get: {
      summary: 'Get my assigned audits',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Assigned audits retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/audit/my-assignments': {
    get: {
      summary: 'List my assignment tasks',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'assignmentRole', in: 'query', schema: { type: 'string', enum: ['team_lead', 'team_member'] } },
        { name: 'activeOnly', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'search', in: 'query', schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Assignments retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/audit/my-assignments/{id}': {
    get: {
      summary: 'Get one assignment task',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Assignment retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/my-assignments/{id}/procedures': {
    get: {
      summary: 'List assignment procedures',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Assignment procedures retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    post: {
      summary: 'Add assignment procedure',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                area: { type: 'string' },
                dueDate: { type: 'string', format: 'date-time' },
                controlReference: { type: 'string' }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Procedure added' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/my-assignments/{id}/status': {
    patch: {
      summary: 'Update assignment status',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] } }
            }
          }
        }
      },
      responses: { '200': { description: 'Assignment status updated' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/my-assignments/{id}/procedures/{procedureId}': {
    put: {
      summary: 'Update assignment procedure',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'procedureId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'submitted'] },
                completionPercentage: { type: 'integer' },
                workingNotes: { type: 'string' },
                evidenceSummary: { type: 'string' }
              }
            }
          }
        }
      },
      responses: { '200': { description: 'Procedure updated' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    delete: {
      summary: 'Delete assignment procedure',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'procedureId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Procedure deleted' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/my-assignments/{id}/submit': {
    post: {
      summary: 'Submit assignment for review',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                targetRole: { type: 'string', enum: ['team_lead', 'quality_assurance', 'chief_audit_executive'] },
                notes: { type: 'string' }
              }
            }
          }
        }
      },
      responses: { '200': { description: 'Assignment submitted for review' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  }
});

Object.assign(swaggerDocument.paths, {
  '/api/audit/audit-notifications': {
    get: {
      summary: 'List audit notifications for audit staff',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'responseStatus', in: 'query', schema: { type: 'string', enum: ['pending', 'confirmed', 'change_requested', 'declined'] } },
        { name: 'notificationType', in: 'query', schema: { type: 'string', enum: ['opening_meeting', 'closing_meeting', 'fieldwork_notice', 'document_deadline', 'general'] } },
        { name: 'auditeeUserId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'auditPlanId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'search', in: 'query', schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Audit notifications retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    },
    post: {
      summary: 'Create an audit notification for an auditee',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['auditeeUserId', 'title', 'scheduledAt'],
              properties: {
                auditeeUserId: { type: 'string', format: 'uuid' },
                auditPlanId: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                notificationType: { type: 'string', enum: ['opening_meeting', 'closing_meeting', 'fieldwork_notice', 'document_deadline', 'general'] },
                badgeLabel: { type: 'string' },
                scheduledAt: { type: 'string', format: 'date-time' },
                locationOrMode: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Audit notification created' }, '400': { $ref: '#/components/responses/BadRequest' } }
    }
  },
  '/api/audit/audit-notifications/{id}': {
    get: {
      summary: 'Get one audit notification',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Audit notification retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/document-requests/bulk': {
    post: {
      summary: 'Create governance document requests for multiple auditees by email',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'auditeeEmails'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                auditPlanId: { type: 'string', format: 'uuid' },
                folderName: { type: 'string' },
                folderKey: { type: 'string' },
                dueDate: { type: 'string', format: 'date-time' },
                auditeeEmails: { type: 'array', items: { type: 'string', format: 'email' } },
                documentTitles: { type: 'array', items: { type: 'string' } },
                auditees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      documentTitles: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Bulk document requests created' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/document-requests': {
    get: {
      summary: 'List governance document requests',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Document requests retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    },
    post: {
      summary: 'Create governance document request',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'assignedTo'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                assignedTo: { type: 'string', format: 'uuid' },
                auditPlanId: { type: 'string', format: 'uuid' },
                recipientEmail: { type: 'string', format: 'email' },
                folderName: { type: 'string' },
                folderKey: { type: 'string' },
                dueDate: { type: 'string', format: 'date-time' },
                documentTitles: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Document request created' }, '400': { $ref: '#/components/responses/BadRequest' } }
    }
  },
  '/api/audit/document-requests/{id}': {
    get: {
      summary: 'Get one governance document request',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Document request retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/document-requests/{id}/comments': {
    get: {
      summary: 'List request comments',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Comments retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    post: {
      summary: 'Add request comment',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              properties: {
                body: { type: 'string' },
                visibility: { type: 'string', enum: ['internal', 'shared'] },
                governanceDocumentId: { type: 'string', format: 'uuid' }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Comment added' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/document-requests/{id}/review': {
    post: {
      summary: 'Review governance document request submission',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['decision'],
              properties: {
                decision: { type: 'string', enum: ['approved', 'rejected', 'under_review'] },
                comments: { type: 'string' }
              }
            }
          }
        }
      },
      responses: { '200': { description: 'Review recorded' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/document-requests/{id}/remind': {
    post: {
      summary: 'Send governance document request reminder',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Reminder sent' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/audit/governance-documents': {
    get: {
      summary: 'List governance documents',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'requestId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'auditPlanId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'assignedTo', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'folderKey', in: 'query', schema: { type: 'string' } },
        { name: 'latestOnly', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
      ],
      responses: { '200': { description: 'Governance documents retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    }
  },
  '/api/audit/governance-documents/{id}': {
    get: {
      summary: 'Get one governance document',
      tags: ['Audit Operations'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Governance document retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/dashboard': {
    get: {
      summary: 'Get auditee dashboard',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Auditee dashboard retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/auditee/audit-notifications': {
    get: {
      summary: 'List auditee audit notifications',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'responseStatus', in: 'query', schema: { type: 'string', enum: ['pending', 'confirmed', 'change_requested', 'declined'] } },
        { name: 'notificationType', in: 'query', schema: { type: 'string', enum: ['opening_meeting', 'closing_meeting', 'fieldwork_notice', 'document_deadline', 'general'] } },
        { name: 'upcomingOnly', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'search', in: 'query', schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Auditee audit notifications retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/auditee/audit-notifications/{id}': {
    get: {
      summary: 'Get one auditee audit notification',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Auditee audit notification retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/audit-notifications/{id}/confirm': {
    post: {
      summary: 'Confirm availability for an audit notification',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { comment: { type: 'string' } }
            }
          }
        }
      },
      responses: { '200': { description: 'Availability confirmed' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/audit-notifications/{id}/request-change': {
    post: {
      summary: 'Request a schedule change for an audit notification',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['comment'],
              properties: {
                comment: { type: 'string' },
                proposedScheduledAt: { type: 'string', format: 'date-time' }
              }
            }
          }
        }
      },
      responses: { '200': { description: 'Change request submitted' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/document-requests': {
    get: {
      summary: 'List auditee document requests',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Auditee document requests retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/auditee/document-requests/{id}': {
    get: {
      summary: 'Get one auditee document request',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Auditee document request retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/document-requests/{id}/comments': {
    get: {
      summary: 'List auditee request comments',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Auditee comments retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    post: {
      summary: 'Add auditee request comment',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              properties: {
                body: { type: 'string' },
                governanceDocumentId: { type: 'string', format: 'uuid' }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Auditee comment added' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/document-requests/{id}/upload': {
    post: {
      summary: 'Upload governance document for request',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['documentFile'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                documentFile: { type: 'string', format: 'binary' }
              }
            }
          }
        }
      },
      responses: { '200': { description: 'Document uploaded' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/auditee/governance-documents': {
    get: {
      summary: 'List auditee governance documents',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'requestId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'folderKey', in: 'query', schema: { type: 'string' } },
        { name: 'latestOnly', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
      ],
      responses: { '200': { description: 'Auditee governance documents retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    }
  },
  '/api/auditee/notifications': {
    get: {
      summary: 'List auditee notifications',
      tags: ['Auditee'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Auditee notifications retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    }
  }
});

Object.assign(swaggerDocument.paths, {
  '/api/team-lead/document-requests/preview': {
    post: {
      summary: 'Preview Team Lead governance document recipients before sending',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'auditeeEmails'],
              properties: {
                title: { type: 'string' },
                auditPlanId: { type: 'string', format: 'uuid' },
                folderName: { type: 'string' },
                folderKey: { type: 'string' },
                auditeeEmails: { type: 'array', items: { type: 'string', format: 'email' } },
                documentTitles: { type: 'array', items: { type: 'string' } },
                auditees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      documentTitles: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      responses: { '200': { description: 'Team Lead recipient preview generated' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/document-requests/bulk': {
    post: {
      summary: 'Create governance document requests for multiple auditees from the Team Lead dashboard',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'auditeeEmails'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                auditPlanId: { type: 'string', format: 'uuid' },
                folderName: { type: 'string' },
                folderKey: { type: 'string' },
                dueDate: { type: 'string', format: 'date-time' },
                auditeeEmails: { type: 'array', items: { type: 'string', format: 'email' } },
                documentTitles: { type: 'array', items: { type: 'string' } },
                auditees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      documentTitles: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      responses: { '201': { description: 'Team Lead bulk document requests created' }, '400': { $ref: '#/components/responses/BadRequest' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/dashboard': {
    get: {
      summary: 'Get Team Lead dashboard summary and approved plans',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Team Lead dashboard retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/team-lead/assignments': {
    get: {
      summary: 'List Team Lead audit assignments',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['not_started', 'ongoing', 'completed'] } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'commenceableOnly', in: 'query', schema: { type: 'boolean' } }
      ],
      responses: { '200': { description: 'Team Lead assignments retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/team-lead/assignments/{id}/commence': {
    post: {
      summary: 'Commence one Team Lead audit assignment',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Assignment commenced' }, '400': { description: 'Assignment cannot be commenced' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace': {
    get: {
      summary: 'Get Team Lead audit planning workspace',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Team Lead planning workspace retrieved' }, '400': { description: 'Assignment not commenced' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    put: {
      summary: 'Update Team Lead audit planning workspace',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Team Lead planning workspace updated' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/objectives': {
    post: {
      summary: 'Add one audit objective to the Team Lead planning workspace',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '201': { description: 'Audit objective added' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/objectives/{objectiveId}': {
    delete: {
      summary: 'Delete one audit objective from the Team Lead planning workspace',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'objectiveId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Audit objective deleted' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/methodology-document': {
    post: {
      summary: 'Upload Team Lead methodology document',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Methodology document uploaded' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/procedures': {
    post: {
      summary: 'Add one Team Lead planning test procedure',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '201': { description: 'Planning procedure added' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/procedures/{procedureId}': {
    put: {
      summary: 'Update one Team Lead planning test procedure',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'procedureId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Planning procedure updated' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    delete: {
      summary: 'Delete one Team Lead planning test procedure',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'procedureId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Planning procedure deleted' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/save-draft': {
    post: {
      summary: 'Save Team Lead planning workspace as draft',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Planning draft saved' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/assignments/{id}/workspace/submit': {
    post: {
      summary: 'Submit Team Lead planning workspace for approval',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Planning workspace submitted for approval' }, '400': { description: 'Invalid request' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/team-lead/approved-plans': {
    get: {
      summary: 'List Team Lead approved audit plans',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['not_started', 'ongoing', 'completed'] } },
        { name: 'riskRating', in: 'query', schema: { type: 'string', enum: ['Very High', 'High', 'Medium', 'Low', 'Very Low'] } },
        { name: 'quarter', in: 'query', schema: { type: 'string', enum: ['Q1', 'Q2', 'Q3', 'Q4'] } },
        { name: 'search', in: 'query', schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Approved plans retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    }
  },
  '/api/team-lead/approved-plans/{id}': {
    get: {
      summary: 'Get one Team Lead approved audit plan',
      tags: ['Team Lead'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Approved plan retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  }
});


Object.assign(swaggerDocument.paths, {
  '/api/annual-audit-plans': {
    get: {
      summary: 'List annual audit plans',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'year', in: 'query', schema: { type: 'integer' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'mineOnly', in: 'query', schema: { type: 'boolean' } }
      ],
      responses: { '200': { description: 'Annual audit plans retrieved' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } }
    },
    post: {
      summary: 'Create annual audit plan',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      responses: { '201': { description: 'Annual audit plan created' }, '400': { description: 'Invalid request' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    }
  },
  '/api/annual-audit-plans/generate-from-risk': {
    post: {
      summary: 'Generate annual audit plan from approved plans and risk data',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      responses: { '201': { description: 'Annual audit plan generated' }, '400': { description: 'Invalid request' }, '401': { $ref: '#/components/responses/Unauthorized' } }
    }
  },
  '/api/annual-audit-plans/{id}': {
    get: {
      summary: 'Get one annual audit plan',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Annual audit plan retrieved' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    put: {
      summary: 'Update annual audit plan',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Annual audit plan updated' }, '400': { description: 'Plan cannot be edited' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    delete: {
      summary: 'Delete draft annual audit plan',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Annual audit plan deleted' }, '400': { description: 'Only draft plans can be deleted' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/annual-audit-plans/{id}/sections': {
    put: {
      summary: 'Replace annual audit plan sections',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Sections updated' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/annual-audit-plans/{id}/sections/{sectionId}/rows': {
    post: {
      summary: 'Add annual audit plan row to section',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'sectionId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '201': { description: 'Row added' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/annual-audit-plans/{id}/sections/{sectionId}/rows/{rowId}': {
    put: {
      summary: 'Update annual audit plan row',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'sectionId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Row updated' }, '404': { $ref: '#/components/responses/NotFound' } }
    },
    delete: {
      summary: 'Delete annual audit plan row',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'sectionId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: { '200': { description: 'Row deleted' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/annual-audit-plans/{id}/recalculate-totals': {
    post: {
      summary: 'Recalculate annual audit plan totals',
      tags: ['Annual Audit Plans'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Totals recalculated' }, '404': { $ref: '#/components/responses/NotFound' } }
    }
  },
  '/api/annual-audit-plans/{id}/submit': { post: { summary: 'Submit annual audit plan for review', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan submitted' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/qa-approve': { post: { summary: 'QA approve annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan QA approved' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/qa-reject': { post: { summary: 'QA reject annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan QA rejected' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/cae-approve': { post: { summary: 'CAE approve annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan CAE approved' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/cae-reject': { post: { summary: 'CAE reject annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan CAE rejected' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/board-submit': { post: { summary: 'Submit annual audit plan to board stage', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan sent to board stage' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/board-approve': { post: { summary: 'Board approve annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan board approved' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/board-reject': { post: { summary: 'Board reject annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan board rejected' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/publish': { post: { summary: 'Publish annual audit plan', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan published' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/summary': { get: { summary: 'Get annual audit plan summary', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan summary retrieved' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/export/json': { get: { summary: 'Export annual audit plan JSON', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan JSON export ready' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/export/pdf': { get: { summary: 'Prepare annual audit plan PDF payload', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan PDF payload ready' }, '404': { $ref: '#/components/responses/NotFound' } } } },
  '/api/annual-audit-plans/{id}/export/docx': { get: { summary: 'Prepare annual audit plan DOCX payload', tags: ['Annual Audit Plans'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Plan DOCX payload ready' }, '404': { $ref: '#/components/responses/NotFound' } } } }
});

Object.assign(swaggerDocument.paths, {
  '/api/qa/apm': {
    get: {
      summary: 'List QA APM review items',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'needs_revision', 'draft'] } },
        { name: 'department', in: 'query', schema: { type: 'string' } }
      ],
      responses: {
        '200': {
          description: 'QA APM review items retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      rows: { type: 'array', items: { $ref: '#/components/schemas/QaApmReviewSummary' } },
                      summary: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' }
      }
    }
  },
  '/api/qa/apm/{id}': {
    get: {
      summary: 'Get one QA APM review item',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': {
          description: 'QA APM review detail retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { $ref: '#/components/schemas/QaApmReviewDetail' }
                }
              },
              example: {
                success: true,
                data: {
                  id: 'APM-2026-001',
                  planId: '2d777c8f-8eaf-4875-bd60-3c96917bb45d',
                  submittedBy: 'Endpoint QA Team Lead',
                  submittedDate: '2026-04-09T07:50:31.000Z',
                  team: 'Endpoint QA Team Lead',
                  auditTitle: 'Financial Crime Review',
                  auditClassification: 'Compliance',
                  duration: 30,
                  unitBackground: 'Seeded for focused QA regression checks.',
                  objectives: ['Validate the QA APM workflow'],
                  scopeOfReview: 'Scope seeded for QA regression tests.',
                  riskAnalysis: 'Seeded risk analysis',
                  controlAnalysis: 'Seeded control analysis',
                  auditApproach: 'Seeded approach',
                  auditProcess: [{ phase: 'Plan', detail: 'seeded workflow' }],
                  testProcedures: [{ objective: 'Confirm QA endpoint behavior', procedure: 'Review seeded plan metadata and submission routing.', assignedTo: 'Endpoint QA' }],
                  status: 'pending',
                  comments: []
                }
              }
            }
          }
        },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/qa/apm/{id}/approve': {
    post: {
      summary: 'Approve a QA APM review item',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                notes: { type: 'string', example: 'Approved after QA review.' }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'QA APM review approved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/qa/apm/{id}/reject': {
    post: {
      summary: 'Reject a QA APM review item',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reason'],
              properties: {
                reason: { type: 'string', example: 'Need clearer procedures' },
                notes: { type: 'string', nullable: true }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'QA APM review returned for revision' },
        '400': { description: 'Invalid rejection reason' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/qa/audit-plans/{id}/review': {
    get: {
      summary: 'Get QA review history for one audit plan',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': {
          description: 'Audit plan QA review history retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { $ref: '#/components/schemas/QaPlanReviewPayload' }
                }
              }
            }
          }
        },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/qa/audit-plans/comments': {
    post: {
      summary: 'Save QA comments or recommendations for audit plans',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['planIds', 'comment'],
              properties: {
                planIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                comment: { type: 'string', example: 'Please strengthen the resource assumptions.' },
                recommendationType: { type: 'string', example: 'general' }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'QA comment saved' },
        '400': { description: 'Missing plan IDs or comment' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/qa/audit-plans/request-modifications': {
    post: {
      summary: 'Request modifications for selected audit plans',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['planIds', 'comment'],
              properties: {
                planIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                comment: { type: 'string', example: 'Please revise the audit scope and add supporting rationale.' }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'Modification request saved' },
        '400': { description: 'Missing plan IDs or comment' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/qa/report-review': {
    get: {
      summary: 'Get QA report review data',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'department', in: 'query', schema: { type: 'string' } }],
      responses: {
        '200': {
          description: 'QA report review data retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      rows: { type: 'array', items: { $ref: '#/components/schemas/QaReportReviewRow' } },
                      summary: { type: 'object' }
                    }
                  }
                }
              },
              example: {
                success: true,
                data: {
                  rows: [
                    {
                      id: '2d777c8f-8eaf-4875-bd60-3c96917bb45d',
                      planNumber: 'QA-REG-1775720548954-1',
                      title: 'Endpoint QA Approved Plan One 1775720548954',
                      unitName: 'Endpoint QA Narrow 1775720548954',
                      workflowStatus: 'approved',
                      riskRating: 'Medium',
                      submittedToCaeAt: '2026-04-09T07:47:22.000Z',
                      caeDecisionStatus: 'approved',
                      caeDecisionAt: '2026-04-09T07:47:29.000Z',
                      latestQaComment: 'Focused QA regression comment.'
                    }
                  ],
                  summary: { total: 1, pending: 0, approved: 1, rejected: 0 }
                }
              }
            }
          }
        }
      }
    }
  },
  '/api/qa/survey-results': {
    get: {
      summary: 'Get synthesized QA survey-style analytics',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: 'QA survey analytics retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      generatedFrom: { type: 'string' },
                      summary: { type: 'object' },
                      assessmentStatus: { type: 'object' },
                      riskBandCounts: { type: 'object' },
                      departmentRows: { type: 'array', items: { $ref: '#/components/schemas/QaSurveyDepartmentRow' } },
                      insights: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              },
              example: {
                success: true,
                data: {
                  generatedFrom: 'risk_assessments_and_audit_plans',
                  summary: { totalAssessments: 4, totalPlans: 6, historicalScores: 2 },
                  assessmentStatus: { pending: 2, completed: 2 },
                  riskBandCounts: { Medium: 4, High: 2 },
                  departmentRows: [
                    { department: 'Endpoint QA Narrow 1775720548954', planCount: 6, averageRiskScore: 71.5 }
                  ],
                  insights: [
                    '6 audit plan(s) are currently available for QA analytics.',
                    '2 historical score row(s) are available for comparative planning.'
                  ]
                }
              }
            }
          }
        }
      }
    }
  },
  '/api/qa/history': {
    get: {
      summary: 'Get QA audit history timeline',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'department', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', example: 100 } }
      ],
      responses: {
        '200': {
          description: 'QA history retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      rows: { type: 'array', items: { $ref: '#/components/schemas/QaHistoryEvent' } },
                      summary: { type: 'object' }
                    }
                  }
                }
              },
              example: {
                success: true,
                data: {
                  rows: [
                    {
                      id: 'qa-plan-comment-1775720760816-82148',
                      sourceType: 'audit_plan',
                      auditPlanId: '2d777c8f-8eaf-4875-bd60-3c96917bb45d',
                      planNumber: 'QA-REG-1775720548954-1',
                      title: 'Endpoint QA Approved Plan One 1775720548954',
                      unitName: 'Endpoint QA Narrow 1775720548954',
                      eventType: 'qa_comment',
                      description: 'Focused QA regression comment.',
                      timestamp: '2026-04-09T07:46:00.816Z',
                      actorName: 'Endpoint QA Reviewer'
                    }
                  ],
                  summary: { totalEvents: 8, returned: 8, auditPlans: 5, riskAssessments: 1 }
                }
              }
            }
          }
        }
      }
    }
  },
  '/api/qa/historical-scores': {
    get: {
      summary: 'List uploaded historical risk scores',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'sourceYear', in: 'query', schema: { type: 'integer', example: 2024 } },
        { name: 'unitName', in: 'query', schema: { type: 'string' } }
      ],
      responses: {
        '200': {
          description: 'Historical risk scores retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      rows: { type: 'array', items: { $ref: '#/components/schemas/HistoricalRiskScorePayload' } },
                      summary: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  '/api/qa/historical-scores/template': {
    get: {
      summary: 'Download the historical risk score template',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: 'Historical score template file',
          content: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: { type: 'string', format: 'binary' }
            }
          }
        }
      }
    }
  },
  '/api/qa/historical-scores/upload': {
    post: {
      summary: 'Upload historical risk scores',
      tags: ['Quality Assurance'],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['riskFile'],
              properties: {
                riskFile: {
                  type: 'string',
                  format: 'binary',
                  description: 'CSV or Excel file containing historical score rows'
                }
              }
            }
          }
        }
      },
      responses: {
        '201': { description: 'Historical scores uploaded' },
        '400': { description: 'No valid rows found in the upload' }
      }
    }
  },
  '/api/cae/master-plan/submissions': {
    get: {
      summary: 'List regular QA master-plan submissions for CAE review',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } },
        { name: 'department', in: 'query', schema: { type: 'string' } }
      ],
      responses: {
        '200': {
          description: 'CAE master-plan submissions retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  count: { type: 'integer', example: 1 },
                  data: { type: 'array', items: { $ref: '#/components/schemas/CaeMasterPlanSubmission' } }
                }
              },
              example: {
                success: true,
                count: 1,
                data: [
                  {
                    submissionId: 'CAE-1775720842561-984',
                    submittedAt: '2026-04-09T07:47:22.000Z',
                    submittedBy: '8d6d1a7f-1eb4-4309-b94a-9858d4a0280d',
                    submittedByName: 'Endpoint QA Reviewer',
                    notes: 'Focused QA submission for approval path.',
                    status: 'pending',
                    decidedAt: null,
                    planCount: 1,
                    plans: [
                      {
                        id: '2d777c8f-8eaf-4875-bd60-3c96917bb45d',
                        planNumber: 'QA-REG-1775720548954-1',
                        title: 'Endpoint QA Approved Plan One 1775720548954',
                        unitName: 'Endpoint QA Narrow 1775720548954',
                        workflowStatus: 'approved',
                        budget: 4200,
                        resourceHours: 100,
                        submittedAt: '2026-04-09T07:47:22.000Z',
                        submittedByName: 'Endpoint QA Reviewer',
                        decisionStatus: 'pending',
                        decisionAt: null
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      }
    }
  },
  '/api/cae/master-plan/submissions/{submissionId}': {
    get: {
      summary: 'Get one regular QA master-plan submission package',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': {
          description: 'CAE master-plan submission retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: { $ref: '#/components/schemas/CaeMasterPlanSubmission' }
                }
              }
            }
          }
        },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/master-plan/submissions/{submissionId}/approve': {
    post: {
      summary: 'Approve a regular QA master-plan submission package',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                notes: { type: 'string', example: 'Approved for implementation.' }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'Master-plan submission approved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/master-plan/submissions/{submissionId}/reject': {
    post: {
      summary: 'Reject a regular QA master-plan submission package',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reason'],
              properties: {
                reason: { type: 'string', example: 'Needs stronger supporting narrative' },
                notes: { type: 'string', nullable: true }
              }
            }
          }
        }
      },
      responses: {
        '200': { description: 'Master-plan submission rejected' },
        '400': { description: 'Invalid rejection reason' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/dashboard': {
    get: {
      summary: 'Get CAE dashboard overview',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: 'CAE dashboard data retrieved'
        }
      }
    }
  },
  '/api/cae/apm': {
    get: {
      summary: 'Get CAE APM approval queue',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'needs_revision', 'draft'] } },
        { name: 'department', in: 'query', schema: { type: 'string' } }
      ],
      responses: {
        '200': {
          description: 'CAE APM approval queue retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      rows: { type: 'array', items: { $ref: '#/components/schemas/CaeApmSummaryRow' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  '/api/cae/apm/{id}': {
    get: {
      summary: 'Get one CAE APM approval detail',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'CAE APM detail retrieved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/apm/{id}/approve': {
    post: {
      summary: 'Approve a CAE APM submission',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'CAE APM submission approved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/apm/{id}/reject': {
    post: {
      summary: 'Return a CAE APM submission for revision',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'CAE APM submission returned for changes' },
        '400': { description: 'Invalid rejection reason' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/report-review': {
    get: {
      summary: 'Get CAE report-review overview',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': { description: 'CAE report-review data retrieved' }
      }
    }
  },
  '/api/cae/board-submissions': {
    get: {
      summary: 'Get CAE board-submission list',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['cae_approved', 'board_pending', 'board_approved', 'board_rejected', 'published'] } },
        { name: 'year', in: 'query', schema: { type: 'integer' } }
      ],
      responses: {
        '200': {
          description: 'CAE board submissions retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  data: {
                    type: 'object',
                    properties: {
                      rows: { type: 'array', items: { $ref: '#/components/schemas/CaeBoardSubmissionRow' } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  '/api/cae/board-submissions/{id}': {
    get: {
      summary: 'Get one CAE board-submission detail',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '200': { description: 'CAE board submission detail retrieved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/history': {
    get: {
      summary: 'Get CAE history timeline',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', example: 100 } }],
      responses: {
        '200': { description: 'CAE history retrieved' }
      }
    }
  },
  '/api/cae/master-plan/submissions/{submissionId}/request-modification': {
    post: {
      summary: 'Request modifications on a regular QA master-plan submission package',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Modification request recorded' },
        '400': { description: 'Invalid modification comment' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/master-plan/{submissionId}': {
    get: {
      summary: 'Get frontend-aligned CAE master-plan review payload',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'CAE master-plan review payload retrieved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  },
  '/api/cae/master-plan/{submissionId}/export/board-ready': {
    get: {
      summary: 'Get board-ready export payload for a CAE master-plan submission',
      tags: ['Chief Audit Executive'],
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'submissionId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': { description: 'Board-ready export payload retrieved' },
        '404': { $ref: '#/components/responses/NotFound' }
      }
    }
  }
});

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
    .swagger-ui .cloudinary-badge { 
      background: #0a2c3d; 
      color: white; 
      padding: 2px 8px; 
      border-radius: 12px; 
      font-size: 10px; 
      margin-left: 8px;
    }
  `,
  customSiteTitle: "KovaPage Audit API Documentation (Cloudinary)",
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

