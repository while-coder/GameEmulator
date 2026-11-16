export function libraryFailureReason(error: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '当前处于离线状态'
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|timed out|超时/i.test(message)) return '连接超时，请稍后重试'
  if (/abort|中断|取消/i.test(message)) return '请求已中断，请重试'
  if (/JSON|格式|字段|目录数据/i.test(message)) return '目录数据暂不可用，请稍后重试'
  return '连接暂不可用，请检查网络后重试'
}
