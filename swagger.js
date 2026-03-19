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
