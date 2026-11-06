// Synthetic wire responses for Tencent 2020-12-29, never real provider data.
export const safeResult = { Suggestion: 'Pass', Label: 'Normal', SubLabel: '', Score: 0, RequestId: 'synthetic-request' };
export const flaggedResult = { Suggestion: 'Block', Label: 'Abuse', SubLabel: '', Score: 99, RequestId: 'synthetic-request' };
export const reviewResult = { ...flaggedResult, Suggestion: 'Review', Score: 60 };
export const valid = result => ({ Response: result });
