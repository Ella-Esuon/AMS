import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceResolver } from './attendance.resolver';
import { ShiftsModule } from '../shifts/shifts.module';

@Module({
  imports: [ShiftsModule],
  providers: [AttendanceService, AttendanceResolver],
  controllers: [AttendanceController],
  exports: [AttendanceService],
})
export class AttendanceModule {}
