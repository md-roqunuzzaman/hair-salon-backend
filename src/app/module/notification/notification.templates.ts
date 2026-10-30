import type { INotificationTranslations } from "./notification.interface.js";
import { notificationName } from './notification.names.js';

export const notificationTemplates = {
  BOOKING_CONFIRMED_SUCCESS: (): INotificationTranslations => ({
    en: { title: 'Booking confirmed', message: 'Your appointment has been confirmed successfully.' },
    'zh-CN': { title: '预约已确认', message: '您的预约已成功确认。' },
    'zh-HK': { title: '預約已確認', message: '您的預約已成功確認。' },
  }),
  POLICY_REFUND_COMPLETED: (amount: number, currency: string, groupPurchase = false): INotificationTranslations => ({
    en: { title: 'Refund completed', message: `Your ${groupPurchase ? 'group purchase refund' : 'refund'} of ${currency} ${amount.toFixed(2)} has been completed.` },
    'zh-CN': { title: '退款已完成', message: `您的${groupPurchase ? '团购' : ''}退款 ${currency} ${amount.toFixed(2)} 已完成。` },
    'zh-HK': { title: '退款已完成', message: `您的${groupPurchase ? '團購' : ''}退款 ${currency} ${amount.toFixed(2)} 已完成。` },
  }),
  POLICY_BOOKING_CANCELLED: (awaitingApproval: boolean): INotificationTranslations => ({
    en: { title: 'Appointment cancelled', message: awaitingApproval ? 'Your appointment was cancelled. Your refund is awaiting merchant approval.' : 'Your appointment has been cancelled.' },
    'zh-CN': { title: '预约已取消', message: awaitingApproval ? '您的预约已取消，退款正在等待商家审批。' : '您的预约已取消。' },
    'zh-HK': { title: '預約已取消', message: awaitingApproval ? '您的預約已取消，退款正在等候商家審批。' : '您的預約已取消。' },
  }),
  REFUND_REQUEST_APPROVED: (amount: number, currency: string): INotificationTranslations => ({
    en: { title: 'Refund Request Approved', message: `Your refund request for ${currency} ${amount.toFixed(2)} has been approved. Your refund will be processed shortly.` },
    'zh-CN': { title: '退款申请已批准', message: `您的 ${currency} ${amount.toFixed(2)} 退款申请已获批准，退款将于稍后处理。` },
    'zh-HK': { title: '退款申請已獲批准', message: `您的 ${currency} ${amount.toFixed(2)} 退款申請已獲批准，退款將於稍後處理。` },
  }),
  REFUND_REQUEST_REJECTED: (amount: number, currency: string, note: string): INotificationTranslations => ({
    en: { title: 'Refund Request Rejected', message: `Your refund request for ${currency} ${amount.toFixed(2)} was rejected. Reason: ${note}` },
    'zh-CN': { title: '退款申请已被拒绝', message: `您的 ${currency} ${amount.toFixed(2)} 退款申请已被拒绝。商家备注：${note}` },
    'zh-HK': { title: '退款申請已被拒絕', message: `您的 ${currency} ${amount.toFixed(2)} 退款申請已被拒絕。商家備註：${note}` },
  }),
  GROUP_PURCHASE_EXPIRED: (): INotificationTranslations => ({
    en: { title: 'Group purchase reservation expired', message: 'Your group purchase reservation expired because payment was not completed before the deadline.' },
    'zh-CN': { title: '团购预留已过期', message: '由于未能在截止时间前完成付款，您的团购预留已过期。' },
    'zh-HK': { title: '團購預留已到期', message: '由於未能在截止時間前完成付款，您的團購預留已到期。' },
  }),
  APPOINTMENT_REMINDER: (date: string, startTime: string, name: string, names?: unknown): INotificationTranslations => ({
    en: { title: 'Upcoming appointment', message: `Reminder: ${notificationName(names, 'en', name, 'service')} on ${date} at ${startTime} (Hong Kong time).` },
    'zh-CN': { title: '预约提醒', message: `您的预约将于 ${date} ${startTime}（香港时间）开始。` },
    'zh-HK': { title: '預約提醒', message: `您的預約將於 ${date} ${startTime}（香港時間）開始。` },
  }),
  BOOKING_CANCELLED: (): INotificationTranslations => ({
    en: {
      title: "Booking cancelled",
      message: "Your appointment has been cancelled.",
    },
    "zh-CN": {
      title: "预约已取消",
      message: "您的预约已取消。",
    },
    "zh-HK": {
      title: "預約已取消",
      message: "您的預約已取消。",
    },
  }),

  BOOKING_RESCHEDULED: (
    date: string,
    startTime: string,
  ): INotificationTranslations => ({
    en: {
      title: "Booking rescheduled",
      message: `Your appointment has been rescheduled to ${date} at ${startTime}.`,
    },
    "zh-CN": {
      title: "预约已改期",
      message: `您的预约已改至 ${date} ${startTime}。`,
    },
    "zh-HK": {
      title: "預約已改期",
      message: `您的預約已改至 ${date} ${startTime}。`,
    },
  }),
  BOOKING_CONFIRMED_RESERVE_NOW: (): INotificationTranslations => ({
    en: {
      title: "Booking confirmed",
      message:
        "Your reservation has been confirmed and full payment has been recorded.",
    },
    "zh-CN": {
      title: "预约已确认",
      message: "您的预约已确认，并已记录全额付款。",
    },
    "zh-HK": {
      title: "預約已確認",
      message: "您的預約已確認，並已記錄全額付款。",
    },
  }),

  BOOKING_CONFIRMED_DEPOSIT: (): INotificationTranslations => ({
    en: {
      title: "Booking confirmed",
      message: "Your deposit reservation has been confirmed.",
    },
    "zh-CN": {
      title: "预约已确认",
      message: "您的定金预约已确认。",
    },
    "zh-HK": {
      title: "預約已確認",
      message: "您的訂金預約已確認。",
    },
  }),

  SERVICE_COMPLETED: (): INotificationTranslations => ({
    en: {
      title: "Service completed",
      message: "Your appointment is complete. You can now leave a review.",
    },
    "zh-CN": {
      title: "服务已完成",
      message: "您的服务已完成。现在可以提交评价。",
    },
    "zh-HK": {
      title: "服務已完成",
      message: "您的服務已完成。現在可以提交評價。",
    },
  }),
  BOOKING_NO_SHOW: (): INotificationTranslations => ({
    en: {
      title: "Appointment marked as no-show",
      message:
        "Your appointment was marked as a no-show because your attendance was not recorded. Please contact the salon if you believe this is incorrect.",
    },

    "zh-CN": {
      title: "预约已标记为未到店",
      message:
        "由于未记录到您的到店信息，您的预约已被标记为未到店。如有疑问，请联系门店。",
    },

    "zh-HK": {
      title: "預約已標記為未到店",
      message:
        "由於未記錄到您的到店資料，您的預約已被標記為未到店。如有疑問，請聯絡分店。",
    },
  }),
  REMAINING_PAYMENT_RECEIVED: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Remaining payment received",
      message: `We have received your remaining payment of ${currency} ${amount.toFixed(2)}. Your appointment is now fully paid.`,
    },

    "zh-CN": {
      title: "已收到尾款",
      message: `我们已收到您的尾款 ${currency} ${amount.toFixed(2)}。您的预约现已全额付清。`,
    },

    "zh-HK": {
      title: "已收到尾款",
      message: `我們已收到您的尾款 ${currency} ${amount.toFixed(2)}。您的預約現已全額付清。`,
    },
  }),
  BOOKING_RESERVED: (
    date: string,
    startTime: string,
  ): INotificationTranslations => ({
    en: {
      title: "Booking reserved",
      message: `Your appointment has been reserved for ${date} at ${startTime}. Please present your reservation QR code and complete payment at the salon.`,
    },

    "zh-CN": {
      title: "预约成功",
      message: `您的预约已成功预留，时间为 ${date} ${startTime}。请到店出示预约二维码并完成付款。`,
    },

    "zh-HK": {
      title: "預約成功",
      message: `您的預約已成功預留，時間為 ${date} ${startTime}。請到店出示預約二維碼並完成付款。`,
    },
  }),
  BRANCH_STATUS_CHANGED: (
    branchName: string,
    isActive: boolean,
    branchTranslations?: unknown,
  ): INotificationTranslations => ({
    en: {
      title: "Branch status updated",
      message: isActive
        ? `${notificationName(branchTranslations, 'en', branchName, 'branch')} is now active and available for bookings.`
        : `${notificationName(branchTranslations, 'en', branchName, 'branch')} is now inactive. Please check your assigned appointments and contact your manager if necessary.`,
    },

    "zh-CN": {
      title: "分店状态已更新",
      message: isActive
        ? `${notificationName(branchTranslations, 'zh-CN', branchName, 'branch')} 现已恢复营业并接受预约。`
        : `${notificationName(branchTranslations, 'zh-CN', branchName, 'branch')} 现已暂停营业。请检查您负责的预约，如有需要请联系经理。`,
    },

    "zh-HK": {
      title: "分店狀態已更新",
      message: isActive
        ? `${notificationName(branchTranslations, 'zh-HK', branchName, 'branch')} 現已恢復營業並接受預約。`
        : `${notificationName(branchTranslations, 'zh-HK', branchName, 'branch')} 現已暫停營業。請檢查您負責的預約，如有需要請聯絡經理。`,
    },
  }),

  BRANCH_UNAVAILABLE: (branchName: string, branchTranslations?: unknown): INotificationTranslations => ({
    en: {
      title: "Important update about your appointment",
      message: `${notificationName(branchTranslations, 'en', branchName, 'branch')} is currently unavailable. Your existing appointment has not been automatically cancelled. Please contact the salon to confirm your appointment arrangements.`,
    },

    "zh-CN": {
      title: "关于您预约的重要通知",
      message: `${notificationName(branchTranslations, 'zh-CN', branchName, 'branch')} 目前暂停营业。您的现有预约不会自动取消。请联系门店确认预约安排。`,
    },

    "zh-HK": {
      title: "關於您預約的重要通知",
      message: `${notificationName(branchTranslations, 'zh-HK', branchName, 'branch')} 目前暫停營業。您的現有預約不會自動取消。請聯絡分店確認預約安排。`,
    },
  }),
  PAY_NOW_CONFIRMED: (): INotificationTranslations => ({
    en: {
      title: "Booking confirmed",
      message: "Your payment was successful and your appointment is confirmed.",
    },
    "zh-CN": {
      title: "预约已确认",
      message: "付款成功，您的预约已确认。",
    },
    "zh-HK": {
      title: "預約已確認",
      message: "付款成功，您的預約已確認。",
    },
  }),

  DEPOSIT_RECEIVED: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Deposit received",
      message: `We received your deposit of ${currency} ${amount.toFixed(2)}. Your appointment is reserved. Please pay the remaining balance at the salon.`,
    },
    "zh-CN": {
      title: "已收到定金",
      message: `已收到您的定金 ${currency} ${amount.toFixed(2)}。预约已预留，请到店支付尾款。`,
    },
    "zh-HK": {
      title: "已收到訂金",
      message: `已收到您的訂金 ${currency} ${amount.toFixed(2)}。預約已預留，請到店支付尾款。`,
    },
  }),

  PAYMENT_FAILED: (): INotificationTranslations => ({
    en: {
      title: "Payment unsuccessful",
      message:
        "Your payment attempt was unsuccessful. You may try again while your booking hold is active.",
    },
    "zh-CN": {
      title: "付款未成功",
      message: "本次付款未成功。若预约保留时间尚未结束，您可以重试。",
    },
    "zh-HK": {
      title: "付款未成功",
      message: "本次付款未成功。如預約保留時間尚未結束，您可以重試。",
    },
  }),

  WALLET_TOPUP_SUCCESS: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Wallet top-up successful",
      message: `Your wallet top-up of ${currency} ${amount.toFixed(2)} was successful.`,
    },
    "zh-CN": {
      title: "钱包充值成功",
      message: `您的钱包已成功充值 ${currency} ${amount.toFixed(2)}。`,
    },
    "zh-HK": {
      title: "錢包增值成功",
      message: `您的錢包已成功增值 ${currency} ${amount.toFixed(2)}。`,
    },
  }),

  LATE_APPOINTMENT_REFUND: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Late payment refunded",
      message: `Your payment of ${currency} ${amount.toFixed(2)} arrived after the booking hold expired and was refunded automatically. The appointment is not confirmed.`,
    },
    "zh-CN": {
      title: "逾期付款已退款",
      message: `您的付款 ${currency} ${amount.toFixed(2)} 在预约保留期结束后到账，现已自动退款。预约未确认。`,
    },
    "zh-HK": {
      title: "逾期付款已退款",
      message: `您的付款 ${currency} ${amount.toFixed(2)} 在預約保留期結束後到帳，現已自動退款。預約未確認。`,
    },
  }),

  GROUP_PURCHASE_SUCCESSFUL: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Group purchase successful",
      message: `Your group purchase payment of ${currency} ${amount.toFixed(2)} was successful. You can now book an appointment.`,
    },
    "zh-CN": {
      title: "团购购买成功",
      message: `您的团购付款 ${currency} ${amount.toFixed(2)} 已成功，现在可以预约服务。`,
    },
    "zh-HK": {
      title: "團購購買成功",
      message: `您的團購付款 ${currency} ${amount.toFixed(2)} 已成功，現在可以預約服務。`,
    },
  }),

  LATE_GROUP_REFUND: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Group purchase refunded",
      message: `Your group purchase payment of ${currency} ${amount.toFixed(2)} arrived after the reservation expired and was refunded.`,
    },
    "zh-CN": {
      title: "团购款项已退款",
      message: `您的团购付款 ${currency} ${amount.toFixed(2)} 在预留期结束后到账，现已退款。`,
    },
    "zh-HK": {
      title: "團購款項已退款",
      message: `您的團購付款 ${currency} ${amount.toFixed(2)} 在預留期結束後到帳，現已退款。`,
    },
  }),

  REFUND_COMPLETED: (
    amount: number,
    currency: string = "HKD",
  ): INotificationTranslations => ({
    en: {
      title: "Refund completed",
      message: `Your refund of ${currency} ${amount.toFixed(2)} has been processed successfully.`,
    },
    "zh-CN": {
      title: "退款已完成",
      message: `您的退款 ${currency} ${amount.toFixed(2)} 已成功处理。`,
    },
    "zh-HK": {
      title: "退款已完成",
      message: `您的退款 ${currency} ${amount.toFixed(2)} 已成功處理。`,
    },
  }),
  REVIEW_PUBLISHED: (
    isUpdated: boolean = false,
  ): INotificationTranslations => ({
    en: {
      title: "Review published",
      message: isUpdated
        ? "Your updated review has been published successfully."
        : "Your review has been published successfully.",
    },
    "zh-CN": {
      title: "评价已发布",
      message: isUpdated
        ? "您更新后的评价已成功发布。"
        : "您的评价已成功发布。",
    },
    "zh-HK": {
      title: "評價已發佈",
      message: isUpdated
        ? "您更新後的評價已成功發佈。"
        : "您的評價已成功發佈。",
    },
  }),

  REVIEW_NEEDS_CHANGES: (
    isUpdated: boolean = false,
  ): INotificationTranslations => ({
    en: {
      title: "Review needs changes",
      message: isUpdated
        ? "Your updated review is not public because it may not meet our review guidelines. You can edit and resubmit it."
        : "Your review is not public because it may not meet our review guidelines. You can edit and resubmit it.",
    },
    "zh-CN": {
      title: "评价需要修改",
      message: isUpdated
        ? "您更新后的评价因可能不符合评价规范而未公开。您可以修改后重新提交。"
        : "您的评价因可能不符合评价规范而未公开。您可以修改后重新提交。",
    },
    "zh-HK": {
      title: "評價需要修改",
      message: isUpdated
        ? "您更新後的評價因可能不符合評價指引而未公開。您可以修改後重新提交。"
        : "您的評價因可能不符合評價指引而未公開。您可以修改後重新提交。",
    },
  }),

  REVIEW_PENDING: (isUpdated: boolean = false): INotificationTranslations => ({
    en: {
      title: "Review under review",
      message: isUpdated
        ? "Your updated review is being checked before publication."
        : "Your review is being checked before publication.",
    },
    "zh-CN": {
      title: "评价审核中",
      message: isUpdated
        ? "您更新后的评价正在审核中，审核完成后才会发布。"
        : "您的评价正在审核中，审核完成后才会发布。",
    },
    "zh-HK": {
      title: "評價審核中",
      message: isUpdated
        ? "您更新後的評價正在審核中，審核完成後才會發佈。"
        : "您的評價正在審核中，審核完成後才會發佈。",
    },
  }),

  REVIEW_REPLY: (): INotificationTranslations => ({
    en: {
      title: "Salon replied to your review",
      message: "The salon has replied to your review.",
    },
    "zh-CN": {
      title: "美发店已回复您的评价",
      message: "美发店已回复您的评价。",
    },
    "zh-HK": {
      title: "髮型屋已回覆您的評價",
      message: "髮型屋已回覆您的評價。",
    },
  }),
  STAFF_ACCOUNT_CREATED: (): INotificationTranslations => ({
    en: {
      title: "Staff account created",
      message:
        "Your staff account has been created successfully. Please sign in using the credentials provided by your administrator and change your temporary password.",
    },
    "zh-CN": {
      title: "员工账户已创建",
      message:
        "您的员工账户已成功创建。请使用管理员提供的登录凭据登录，并修改临时密码。",
    },
    "zh-HK": {
      title: "員工帳戶已建立",
      message:
        "您的員工帳戶已成功建立。請使用管理員提供的登入資料登入，並更改臨時密碼。",
    },
  }),
  STAFF_ACTIVATED: (): INotificationTranslations => ({
    en: {
      title: "Staff account activated",
      message:
        "Your staff account has been activated. You can now access your assigned staff features.",
    },
    "zh-CN": {
      title: "员工账户已启用",
      message: "您的员工账户已启用。您现在可以使用已分配的员工功能。",
    },
    "zh-HK": {
      title: "員工帳戶已啟用",
      message: "您的員工帳戶已啟用。您現在可以使用已分配的員工功能。",
    },
  }),

  STAFF_DEACTIVATED: (): INotificationTranslations => ({
    en: {
      title: "Staff account deactivated",
      message:
        "Your staff account has been deactivated. Please contact your salon administrator for more information.",
    },
    "zh-CN": {
      title: "员工账户已停用",
      message: "您的员工账户已停用。如需了解更多信息，请联系沙龙管理员。",
    },
    "zh-HK": {
      title: "員工帳戶已停用",
      message: "您的員工帳戶已停用。如需了解更多資訊，請聯絡髮廊管理員。",
    },
  }),
  STAFF_BRANCH_ASSIGNMENT_UPDATED: (): INotificationTranslations => ({
    en: {
      title: "Branch assignment updated",
      message:
        "Your salon branch assignments have been updated. Please check your assigned branches for the latest information.",
    },
    "zh-CN": {
      title: "分店分配已更新",
      message: "您的沙龙分店分配已更新。请查看您最新分配的分店信息。",
    },
    "zh-HK": {
      title: "分店分配已更新",
      message: "您的髮廊分店分配已更新。請查看您最新獲分配的分店資訊。",
    },
  }),
  STAFF_SCHEDULE_UPDATED: (): INotificationTranslations => ({
    en: {
      title: "Work schedule updated",
      message:
        "Your work schedule has been updated. Please check your latest working days, assigned branches, and shift times.",
    },
    "zh-CN": {
      title: "工作排班已更新",
      message: "您的工作排班已更新。请查看最新的工作日期、所属分店及班次时间。",
    },
    "zh-HK": {
      title: "工作更表已更新",
      message: "您的工作更表已更新。請查看最新的工作日、所屬分店及更次時間。",
    },
  }),
};
