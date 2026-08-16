import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsResolver } from './notifications.resolver';
import { LeaveNotificationsListener } from './listeners/leave-notifications.listener';

@Module({
  providers: [NotificationsService, NotificationsResolver, LeaveNotificationsListener],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
