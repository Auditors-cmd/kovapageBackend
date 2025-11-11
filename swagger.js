const swaggerUi = require('swagger-ui-express');

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'KovaPage Backend API',
    version: '1.0.0',
    description: `
# KovaPage - Complete Authentication API with PostgreSQL

## Overview
Complete authentication system with both OTP and password-based authentication, user management, and password reset functionality using PostgreSQL database.

## Authentication Methods
- **OTP Authentication**: Email-based one-time password for registration and login
- **Password Authentication**: Traditional email/password registration and login
- **Password Reset**: Secure OTP-based password reset flow

## Database
- **PostgreSQL**: Relational database for user management
- **UUID Primary Keys**: Secure user identification
- **Data Validation**: Comprehensive input validation

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
      url: 'https://your-render-app.onrender.com',
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
      description: 'User profile and status endpoints'
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

      // Request Schemas
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
          }
        },
        example: {
          email: 'auditor@company.com',
          name: 'John Auditor'
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
            description: 'User password (min 6 characters)'
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
            description: 'New password (min 6 characters)'
          }
        },
        example: {
          email: 'auditor@company.com',
          otp: '123456',
          newPassword: 'newpassword123'
        }
      },

      // Response Schemas
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
            type: 'string',
            enum: ['auditor', 'manager', 'admin'],
            description: 'User role'
          },
          isEmailVerified: {
            type: 'boolean',
            description: 'Email verification status'
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
          name: 'John Auditor',
          email: 'auditor@company.com',
          role: 'auditor',
          isEmailVerified: true,
          authMethod: 'email_otp',
          lastLogin: '2024-01-15T10:30:00.000Z',
          createdAt: '2024-01-15T10:00:00.000Z',
          updatedAt: '2024-01-15T10:30:00.000Z'
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
              }
            }
          }
        },
        example: {
          success: true,
          message: 'Verification code sent to auditor@company.com',
          data: {
            email: 'auditor@company.com',
            name: 'John Auditor'
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
        summary: 'Register with Password',
        description: 'Register a new user with email and password (stored in PostgreSQL)',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/PasswordRegisterRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'User registered successfully in PostgreSQL',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse'
                },
                example: {
                  success: true,
                  message: 'User registered successfully! Welcome to KovaPage!',
                  data: {
                    user: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'John Auditor',
                      email: 'auditor@company.com',
                      role: 'auditor',
                      isEmailVerified: false,
                      authMethod: 'password',
                      lastLogin: '2024-01-15T10:30:00.000Z',
                      createdAt: '2024-01-15T10:00:00.000Z',
                      updatedAt: '2024-01-15T10:30:00.000Z'
                    },
                    token: 'jwt_token_123456'
                  }
                }
              }
            }
          },
          '400': {
            $ref: '#/components/responses/BadRequest'
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
        description: 'Authenticate user with email and password (validated against PostgreSQL)',
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
                  message: 'Welcome back, John Auditor!',
                  data: {
                    user: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'John Auditor',
                      email: 'auditor@company.com',
                      role: 'auditor',
                      isEmailVerified: true,
                      authMethod: 'password',
                      lastLogin: '2024-01-15T10:30:00.000Z',
                      createdAt: '2024-01-15T10:00:00.000Z',
                      updatedAt: '2024-01-15T10:30:00.000Z'
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
                },
                example: {
                  success: false,
                  message: 'Invalid credentials'
                }
              }
            }
          },
          '400': {
            $ref: '#/components/responses/BadRequest'
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },

    // =======================
    // OTP AUTHENTICATION
    // =======================
    '/api/auth/email/register': {
      post: {
        summary: 'Request OTP for Registration',
        description: 'Send OTP to email for new user registration (user stored in PostgreSQL after verification)',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
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
          '400': {
            $ref: '#/components/responses/BadRequest'
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },
    '/api/auth/email/verify': {
      post: {
        summary: 'Verify OTP and Register',
        description: 'Verify OTP and create user in PostgreSQL database',
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
          '200': {
            description: 'OTP verified and user created in PostgreSQL',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AuthResponse'
                },
                example: {
                  success: true,
                  message: 'Registration successful! Welcome to KovaPage!',
                  data: {
                    user: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'John Auditor',
                      email: 'auditor@company.com',
                      role: 'auditor',
                      isEmailVerified: true,
                      authMethod: 'email_otp',
                      lastLogin: '2024-01-15T10:30:00.000Z',
                      createdAt: '2024-01-15T10:00:00.000Z',
                      updatedAt: '2024-01-15T10:30:00.000Z'
                    },
                    token: 'jwt_token_123456'
                  }
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
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },
    '/api/auth/email/login': {
      post: {
        summary: 'Request OTP for Login',
        description: 'Send OTP to email for existing user login (user verified in PostgreSQL)',
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
          '400': {
            $ref: '#/components/responses/BadRequest'
          },
          '404': {
            description: 'User not found in database',
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
    '/api/auth/email/verify-login': {
      post: {
        summary: 'Verify OTP for Login',
        description: 'Verify OTP and authenticate existing user from PostgreSQL',
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
                },
                example: {
                  success: true,
                  message: 'Welcome back, John Auditor!',
                  data: {
                    user: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'John Auditor',
                      email: 'auditor@company.com',
                      role: 'auditor',
                      isEmailVerified: true,
                      authMethod: 'email_otp',
                      lastLogin: '2024-01-15T10:30:00.000Z',
                      createdAt: '2024-01-15T10:00:00.000Z',
                      updatedAt: '2024-01-15T10:30:00.000Z'
                    },
                    token: 'jwt_token_123456'
                  }
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
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },

    // =======================
    // PASSWORD RESET
    // =======================
    '/api/auth/forgot-password': {
      post: {
        summary: 'Forgot Password',
        description: 'Request password reset OTP for email (user verified in PostgreSQL)',
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
            description: 'Reset OTP sent successfully',
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
                    }
                  },
                  example: {
                    success: true,
                    message: 'Password reset code sent to your email'
                  }
                }
              }
            }
          },
          '400': {
            $ref: '#/components/responses/BadRequest'
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },
    '/api/auth/reset-password': {
      post: {
        summary: 'Reset Password',
        description: 'Reset password using OTP and update in PostgreSQL database',
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
            description: 'Password reset successfully in PostgreSQL',
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
                    }
                  },
                  example: {
                    success: true,
                    message: 'Password reset successfully! You can now login with your new password.'
                  }
                }
              }
            }
          },
          '400': {
            $ref: '#/components/responses/BadRequest'
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },

    // =======================
    // USER MANAGEMENT
    // =======================
    '/api/auth/profile': {
      get: {
        summary: 'Get User Profile',
        description: 'Get current user profile from PostgreSQL (requires authentication)',
        tags: ['User Management'],
        security: [{
          bearerAuth: []
        }],
        responses: {
          '200': {
            description: 'User profile retrieved successfully from PostgreSQL',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true
                    },
                    data: {
                      $ref: '#/components/schemas/UserResponse'
                    }
                  }
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '404': {
            $ref: '#/components/responses/NotFound'
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
        }
      }
    },
    '/api/auth/status': {
      get: {
        summary: 'Check Authentication Status',
        description: 'Check if user is authenticated and get current user data from PostgreSQL (requires authentication)',
        tags: ['User Management'],
        security: [{
          bearerAuth: []
        }],
        responses: {
          '200': {
            description: 'Authentication status retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true
                    },
                    isAuthenticated: {
                      type: 'boolean',
                      example: true
                    },
                    data: {
                      $ref: '#/components/schemas/UserResponse'
                    }
                  }
                }
              }
            }
          },
          '401': {
            $ref: '#/components/responses/Unauthorized'
          },
          '500': {
            $ref: '#/components/responses/ServerError'
          }
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
  `,
  customSiteTitle: "KovaPage API Documentation (PostgreSQL)",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
  }
};

module.exports = {
  swaggerUi,
  swaggerDocument,
  swaggerOptions
};