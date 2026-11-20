import { Router } from 'express';
import { Role } from '../../../../generated/prisma/enums.js';
import { prisma } from '../../lib/prisma.js';
import { auth } from '../../middleware/auth.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { createAdminOrderService } from './admin-order.service.js';
import { orderParams, orderQuery } from './admin-order.validation.js';

const router = Router();
// WebSocketPair is a workerd global; Node/PostgreSQL has no such global.
const dialect = 'WebSocketPair' in globalThis ? 'sqlite' : 'postgresql';
router.use(auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER));
router.get('/', catchAsync(async (req, res) => {
  const query = orderQuery.parse(req.query);
  const result = await prisma.$transaction(tx => createAdminOrderService(tx, dialect).list(req.user!, query),
    { isolationLevel: 'RepeatableRead' });
  sendResponse(res, { success: true, statusCode: 200, message: 'Orders fetched successfully', data: result });
}));
router.get('/:orderType/:orderId', catchAsync(async (req, res) => {
  const params = orderParams.parse(req.params);
  const result = await prisma.$transaction(tx => createAdminOrderService(tx, dialect)
    .detail(req.user!, orderQuery.parse({}), params.orderType, params.orderId),
    { isolationLevel: 'RepeatableRead' });
  sendResponse(res, { success: true, statusCode: 200, message: 'Order fetched successfully', data: result });
}));
export const AdminOrderRoutes = router;
