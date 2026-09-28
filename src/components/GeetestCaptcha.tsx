"use client";

import Script from "next/script";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type { CaptchaTicket } from "@/lib/captcha";

const GEETEST_SCRIPT_URL = "https://static.geetest.com/v4/gt4.js";

/** 极验 v4 实例：官方 SDK 未提供类型定义，这里只声明本项目用到的接口 */
interface GeetestInstance {
  appendTo: (target: HTMLElement) => GeetestInstance;
  onSuccess: (callback: () => void) => GeetestInstance;
  onError?: (callback: () => void) => GeetestInstance;
  onClose?: (callback: () => void) => GeetestInstance;
  showBox: () => void;
  getValidate: () => Partial<CaptchaTicket> | undefined;
  reset: () => void;
}

type InitGeetest4 = (
  options: { captchaId: string; product: "bind"; language?: string },
  callback: (captcha: GeetestInstance) => void
) => void;

declare global {
  interface Window {
    initGeetest4?: InitGeetest4;
  }
}

export interface GeetestCaptchaHandle {
  /** 触发人机验证（提交按钮与回车键共用同一入口） */
  trigger: () => void;
  /** 重置验证：票据一次性，提交失败后必须重新验证 */
  reset: () => void;
}

interface GeetestCaptchaProps {
  label: string;
  loadingLabel: string;
  disabled?: boolean;
  loading?: boolean;
  /** 递增即重置验证码（提交失败后由页面调用） */
  resetSignal?: number;
  /** 验证通过后回调；验证不可用时 ticket 为 null，由服务端降级策略决定是否放行 */
  onVerified: (ticket: CaptchaTicket | null) => void;
  ref?: Ref<GeetestCaptchaHandle>;
}

function normalizeTicket(raw: Partial<CaptchaTicket> | undefined): CaptchaTicket | null {
  if (!raw) return null;
  const { lot_number, captcha_output, pass_token, gen_time } = raw;
  if (!lot_number || !captcha_output || !pass_token || !gen_time) return null;
  return { lot_number, captcha_output, pass_token, gen_time };
}

/**
 * 极验行为验证（#155，产品形态：bind —— 绑定提交按钮，点击时弹验证）
 * - 容器与文案使用项目语义 token，浅色 / 深色主题下均可见可操作（极验弹层沿用其官方样式）
 * - 凭证未配置或脚本不可用时降级为「直接提交」，由服务端 fail-open 策略与降级审计兜底
 */
export default function GeetestCaptcha({
  label,
  loadingLabel,
  disabled = false,
  loading = false,
  resetSignal = 0,
  onVerified,
  ref,
}: GeetestCaptchaProps) {
  const captchaId = process.env.NEXT_PUBLIC_GEETEST_CAPTCHA_ID ?? "";
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<GeetestInstance | null>(null);
  const ticketRef = useRef<CaptchaTicket | null>(null);
  const initializedRef = useRef(false);
  const onVerifiedRef = useRef(onVerified);

  // skipped：未配置凭证（本地开发 / 降级部署），直接提交由服务端 fail-open 裁决
  // blocked：脚本被拦截或初始化失败，本地提示重试，不静默放行
  const [status, setStatus] = useState<"loading" | "ready" | "blocked" | "skipped">(
    captchaId ? "loading" : "skipped"
  );
  const [notice, setNotice] = useState("");

  // 回调经 ref 转发：避免父组件每次渲染都重新初始化验证码实例
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  const initCaptcha = useCallback(() => {
    if (!captchaId || initializedRef.current) return;
    const init = window.initGeetest4;
    const container = containerRef.current;
    if (!init || !container) return;
    initializedRef.current = true;
    try {
      init({ captchaId, product: "bind", language: "zho" }, (captcha) => {
        instanceRef.current = captcha;
        captcha.appendTo(container);
        captcha.onSuccess(() => {
          const ticket = normalizeTicket(captcha.getValidate());
          ticketRef.current = ticket;
          if (ticket) onVerifiedRef.current(ticket);
        });
        captcha.onError?.(() => setStatus("blocked"));
        setStatus("ready");
      });
    } catch (err) {
      console.error("Geetest init failed:", err);
      setStatus("blocked");
    }
  }, [captchaId]);

  // 脚本已加载（页面间跳转复用）时直接初始化，不依赖 onLoad 再次触发。
  // 初始化幂等（initializedRef 保护），仅在异常分支同步置为 unavailable。
  /* eslint-disable react-hooks/set-state-in-effect -- 第三方脚本初始化：幂等且仅失败分支同步更新状态 */
  useEffect(() => {
    initCaptcha();
  }, [initCaptcha]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!resetSignal) return;
    ticketRef.current = null;
    instanceRef.current?.reset();
  }, [resetSignal]);

  const submit = useCallback(() => {
    if (loading) return;
    setNotice("");
    if (status === "skipped") {
      // 未配置凭证：交由服务端降级策略处理（放行 + auth:captcha-degraded 审计）
      onVerifiedRef.current(null);
      return;
    }
    if (status === "ready" && instanceRef.current) {
      const ticket = ticketRef.current;
      if (ticket) {
        onVerifiedRef.current(ticket);
        return;
      }
      instanceRef.current.showBox();
      return;
    }
    // 组件被拦截或初始化失败：提示用户重试，避免静默放行削弱防护
    setNotice("人机验证组件加载失败，请检查浏览器拦截设置或稍后重试");
  }, [loading, status]);

  useImperativeHandle(
    ref,
    () => ({
      trigger: submit,
      reset: () => {
        ticketRef.current = null;
        instanceRef.current?.reset();
      },
    }),
    [submit]
  );

  return (
    <div className="space-y-3">
      <Script
        src={GEETEST_SCRIPT_URL}
        strategy="afterInteractive"
        onLoad={initCaptcha}
        onError={() => setStatus("blocked")}
      />
      {captchaId ? (
        <div className="min-h-[46px] rounded-xl border border-border-soft bg-background/60 px-3 py-2.5 flex items-center justify-center">
          <div ref={containerRef} className="w-full flex justify-center" aria-label="人机验证" />
          {status === "loading" && <p className="text-xs text-muted">正在加载人机验证…</p>}
        </div>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={disabled || loading}
        className="w-full py-3 bg-primary hover:bg-primary-strong disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {loading ? loadingLabel : label}
      </button>
      {notice ? <p className="text-sm text-danger">{notice}</p> : null}
    </div>
  );
}
