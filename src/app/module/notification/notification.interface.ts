export interface IGetNotificationsQuery {
  page: number;
  limit: number;
  unreadOnly?: boolean;
}

export interface ICreateNotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;
}
