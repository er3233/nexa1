import React from "react";

// Render sırasında oluşan bir hatayı yakalar ve siyah ekran yerine
// anlaşılır bir hata ekranı gösterir. Böylece tek bir bileşen hatası
// tüm uygulamayı düşürmez.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Teknik ayrıntı yalnızca console'a; kullanıcıya gösterilmez.
    console.error("[Nexa] Yakalanan render hatası:", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Teknik yığın izi yalnızca geliştirme modunda gösterilir.
    const isDev = Boolean(import.meta?.env?.DEV);

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-7 text-center relative z-10"
        style={{ color: "var(--txt)" }}>
        <div className="w-14 h-14 rounded-[22px] flex items-center justify-center mb-5"
          style={{ background: "rgba(229,72,77,0.1)", border: "1px solid rgba(229,72,77,0.3)" }}>
          <span style={{ color: "var(--red)", fontSize: 24, fontWeight: 700 }}>!</span>
        </div>
        <h1 className="nx-display text-[18px] font-bold mb-2">Bir şeyler ters gitti</h1>
        <p className="text-[12.5px] leading-relaxed mb-5" style={{ color: "var(--txt2)" }}>
          Beklenmeyen bir sorun oluştu. Lütfen sayfayı yenileyin. Sorun sürerse
          bir süre sonra tekrar deneyin.
        </p>
        {isDev && (
          <pre className="w-full max-w-full overflow-auto text-left text-[10.5px] leading-relaxed rounded-[16px] p-3 mb-5"
            style={{ background: "var(--ink2)", border: "1px solid var(--line)", color: "var(--red)", maxHeight: 180 }}>
            {String(error?.message || error)}
          </pre>
        )}
        <div className="flex gap-2.5">
          <button onClick={this.handleReset}
            className="min-h-[44px] px-5 rounded-[16px] nx-surface text-[13px] font-semibold">
            Yeniden dene
          </button>
          <button onClick={() => window.location.reload()}
            className="min-h-[44px] px-5 rounded-[16px] nx-btn-primary text-[13px]">
            Sayfayı yenile
          </button>
        </div>
      </div>
    );
  }
}
