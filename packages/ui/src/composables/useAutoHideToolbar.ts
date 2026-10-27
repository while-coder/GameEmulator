import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

// ===== 游戏运行时自动隐藏顶部工具栏(沉浸式),需要时再唤出 =====
// active 为真(通常 = 已载入且未暂停)时进入自动隐藏模式:默认收起,
// 点击顶部热区 / 把手切换显示(所有平台统一用点击,不再用鼠标 hover),唤出后定时自动收起。
// active 为假(未载入 / 暂停 / 遥控暂停)时工具栏恒显示——TV 无鼠标无触屏,靠暂停调出。

export interface AutoHideToolbarApi {
  /** 工具栏当前是否应显示 */
  visible: Ref<boolean>
  /** 点击顶部热区 / 把手:切换显示,唤出后定时自动收起 */
  toggle: () => void
}

export function useAutoHideToolbar(
  active: Ref<boolean>,
  opts?: { timeout?: number },
): AutoHideToolbarApi {
  const timeout = opts?.timeout ?? 3000 // 唤出后自动收起延时(ms)
  const revealed = ref(false)
  let hideTimer = 0

  // 非自动隐藏模式恒显示;否则由点击控制。
  const visible = computed(() => !active.value || revealed.value)

  function clearTimer(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
  }

  function toggle(): void {
    clearTimer()
    revealed.value = !revealed.value
    // 唤出后定时自动隐藏:去掉 hover 后,这是唯一的自动收起路径(否则展开后无处收回)。
    if (revealed.value) {
      hideTimer = window.setTimeout(() => {
        revealed.value = false
        hideTimer = 0
      }, timeout)
    }
  }

  // 退出自动隐藏模式(暂停/停止)时复位,避免残留 revealed 状态。
  watch(active, (v) => {
    if (!v) {
      revealed.value = false
      clearTimer()
    }
  })

  onBeforeUnmount(clearTimer)

  return { visible, toggle }
}
