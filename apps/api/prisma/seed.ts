import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── System Permissions ───────────────────────────────────────────────────

  const permissions = [
    // Attendance
    { resource: 'attendance', action: 'create', category: 'Attendance', description: 'Check in/out' },
    { resource: 'attendance', action: 'read', category: 'Attendance', description: 'View attendance records' },
    { resource: 'attendance', action: 'update', category: 'Attendance', description: 'Edit attendance records' },
    { resource: 'attendance', action: 'delete', category: 'Attendance', description: 'Delete attendance records' },
    { resource: 'attendance', action: 'approve', category: 'Attendance', description: 'Approve correction requests' },
    { resource: 'attendance', action: 'export', category: 'Attendance', description: 'Export attendance data' },
    // Users
    { resource: 'users', action: 'create', category: 'Users', description: 'Create user accounts' },
    { resource: 'users', action: 'read', category: 'Users', description: 'View user profiles' },
    { resource: 'users', action: 'update', category: 'Users', description: 'Edit user profiles' },
    { resource: 'users', action: 'delete', category: 'Users', description: 'Delete user accounts' },
    { resource: 'users', action: 'invite', category: 'Users', description: 'Invite users' },
    { resource: 'users', action: 'export', category: 'Users', description: 'Export user data' },
    // Departments
    { resource: 'departments', action: 'create', category: 'Organization', description: 'Create departments' },
    { resource: 'departments', action: 'read', category: 'Organization', description: 'View departments' },
    { resource: 'departments', action: 'update', category: 'Organization', description: 'Edit departments' },
    { resource: 'departments', action: 'delete', category: 'Organization', description: 'Delete departments' },
    // Leaves
    { resource: 'leaves', action: 'create', category: 'Leaves', description: 'Submit leave requests' },
    { resource: 'leaves', action: 'read', category: 'Leaves', description: 'View leave requests' },
    { resource: 'leaves', action: 'update', category: 'Leaves', description: 'Edit leave requests' },
    { resource: 'leaves', action: 'approve', category: 'Leaves', description: 'Approve leave requests' },
    { resource: 'leaves', action: 'reject', category: 'Leaves', description: 'Reject leave requests' },
    // Shifts
    { resource: 'shifts', action: 'create', category: 'Scheduling', description: 'Create shifts' },
    { resource: 'shifts', action: 'read', category: 'Scheduling', description: 'View shifts' },
    { resource: 'shifts', action: 'update', category: 'Scheduling', description: 'Edit shifts' },
    { resource: 'shifts', action: 'delete', category: 'Scheduling', description: 'Delete shifts' },
    // Reports
    { resource: 'reports', action: 'read', category: 'Reports', description: 'View reports' },
    { resource: 'reports', action: 'export', category: 'Reports', description: 'Export reports' },
    // Settings
    { resource: 'settings', action: 'read', category: 'Settings', description: 'View settings' },
    { resource: 'settings', action: 'update', category: 'Settings', description: 'Modify settings' },
    // Roles
    { resource: 'roles', action: 'create', category: 'Security', description: 'Create roles' },
    { resource: 'roles', action: 'read', category: 'Security', description: 'View roles' },
    { resource: 'roles', action: 'update', category: 'Security', description: 'Edit roles' },
    { resource: 'roles', action: 'delete', category: 'Security', description: 'Delete roles' },
    { resource: 'roles', action: 'assign', category: 'Security', description: 'Assign roles to users' },
    // Audit
    { resource: 'audit', action: 'read', category: 'Security', description: 'View audit logs' },
    { resource: 'audit', action: 'export', category: 'Security', description: 'Export audit logs' },
    // Visitors
    { resource: 'visitors', action: 'create', category: 'Visitors', description: 'Register visitors' },
    { resource: 'visitors', action: 'read', category: 'Visitors', description: 'View visitors' },
    { resource: 'visitors', action: 'update', category: 'Visitors', description: 'Edit visitor records' },
    // Contractors
    { resource: 'contractors', action: 'create', category: 'Contractors', description: 'Add contractors' },
    { resource: 'contractors', action: 'read', category: 'Contractors', description: 'View contractors' },
    { resource: 'contractors', action: 'update', category: 'Contractors', description: 'Edit contractor records' },
    // AI
    { resource: 'ai', action: 'read', category: 'AI', description: 'Access AI insights' },
    { resource: 'ai', action: 'query', category: 'AI', description: 'Query AI assistant' },
  ];

  console.log(`  Creating ${permissions.length} permissions...`);
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { resource_action_scope: { resource: perm.resource, action: perm.action, scope: 'tenant' } },
      update: { description: perm.description, category: perm.category },
      create: { ...perm, scope: 'tenant' },
    });
  }

  // ─── Demo Tenant + Admin ──────────────────────────────────────────────────

  console.log('  Creating demo tenant...');

  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'demo-company' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo-company',
      contactEmail: 'admin@demo.ams.io',
      plan: 'PROFESSIONAL',
      status: 'ACTIVE',
      timezone: 'UTC',
      maxUsers: 100,
      primaryColor: '#3B82F6',
      features: {
        attendance: true,
        qrCheckIn: true,
        faceRecognition: true,
        gpsGeofencing: true,
        shifts: true,
        leaveManagement: true,
        visitors: true,
        contractors: true,
        reports: true,
        aiInsights: false,
        notifications: true,
        webhooks: true,
      },
      settings: { allowSelfCheckIn: true, requireLocation: false },
    },
  });

  // Create tenant roles
  const roleDefinitions = [
    { name: 'Tenant Administrator', slug: 'tenant_admin', priority: 100, isSystem: true },
    { name: 'HR Manager', slug: 'hr_manager', priority: 80, isSystem: true },
    { name: 'Department Manager', slug: 'department_manager', priority: 60, isSystem: true },
    { name: 'Employee', slug: 'employee', priority: 10, isSystem: true, isDefault: true },
    { name: 'Security Officer', slug: 'security_officer', priority: 40, isSystem: true },
    { name: 'Contractor', slug: 'contractor', priority: 10, isSystem: true },
    { name: 'Visitor', slug: 'visitor', priority: 5, isSystem: true },
  ];

  console.log('  Creating tenant roles...');
  const roles: Record<string, { id: string }> = {};
  for (const roleDef of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { tenantId_slug: { tenantId: demoTenant.id, slug: roleDef.slug } },
      update: {},
      create: { ...roleDef, tenantId: demoTenant.id, scope: 'TENANT' },
    });
    roles[roleDef.slug] = role;
  }

  // Assign permissions to admin role
  const allPermissions = await prisma.permission.findMany();
  const adminRole = roles['tenant_admin'];
  if (adminRole) {
    for (const perm of allPermissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: perm.id },
      });
    }
  }

  // Assign read permissions to employee role
  const employeeRole = roles['employee'];
  const employeePerms = allPermissions.filter((p) =>
    ['attendance:create', 'attendance:read', 'leaves:create', 'leaves:read', 'shifts:read'].includes(
      `${p.resource}:${p.action}`,
    ),
  );
  if (employeeRole) {
    for (const perm of employeePerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: employeeRole.id, permissionId: perm.id },
      });
    }
  }

  // Create demo admin user
  console.log('  Creating demo admin user...');
  const passwordHash = await bcrypt.hash('Admin@123456', 12);

  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: demoTenant.id, email: 'admin@demo.ams.io' } },
    update: {},
    create: {
      tenantId: demoTenant.id,
      email: 'admin@demo.ams.io',
      firstName: 'System',
      lastName: 'Admin',
      userType: 'TENANT_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      metadata: { passwordHash },
    },
  });

  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
      update: {},
      create: { userId: adminUser.id, roleId: adminRole.id, tenantId: demoTenant.id },
    });
  }

  await prisma.userProfile.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: { userId: adminUser.id, tenantId: demoTenant.id },
  });

  // Create sample departments
  const departments = ['Engineering', 'Human Resources', 'Finance', 'Operations', 'Marketing'];
  console.log('  Creating sample departments...');
  for (const deptName of departments) {
    await prisma.department.upsert({
      where: { tenantId_code: { tenantId: demoTenant.id, code: deptName.toUpperCase().slice(0, 3) } },
      update: {},
      create: {
        tenantId: demoTenant.id,
        name: deptName,
        code: deptName.toUpperCase().slice(0, 3),
        isActive: true,
      },
    });
  }

  console.log('✅ Seed completed successfully!');
  console.log('');
  console.log('📋 Demo Credentials:');
  console.log('   Tenant Slug: demo-company');
  console.log('   Admin Email: admin@demo.ams.io');
  console.log('   Password:    Admin@123456');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
