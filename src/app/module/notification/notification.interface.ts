export interface IGetNotificationsQuery {
  page: number;
  limit: number;
  unreadOnly?: boolean;
}

// =====================================================
// NOTIFICATION TRANSLATIONS
// =====================================================

export interface INotificationLocalizedContent {
  title?: string;
  message?: string;
}

export interface INotificationTranslations {
  en?: INotificationLocalizedContent;
  "zh-CN"?: INotificationLocalizedContent;
  "zh-HK"?: INotificationLocalizedContent;
}

// =====================================================
// CREATE NOTIFICATION PAYLOAD
// =====================================================

export interface ICreateNotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;

  translations?: INotificationTranslations;
  // Internal event context; never persisted as customer notification content.
  appointmentId?: string;

  previousStaffId?: string | null;

  emailIntent?: {
    appointmentId: string;

    previous: {
      date: string;
      startTime: string;
      endTime: string;
      staffId: string | null;
    };

    target: {
      date: string;
      startTime: string;
      endTime: string;
      staffId: string | null;
      revision: number;
    };
  };
}
