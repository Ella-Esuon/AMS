import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { AbacService } from './abac.service';

@Module({
  providers: [RolesService, AbacService],
  controllers: [RolesController],
  exports: [RolesService, AbacService],
})
export class RolesModule {}
