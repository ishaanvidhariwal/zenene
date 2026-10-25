/* =========================================================
   ZENENE SHARED UI
   Gentle scroll reveals + the same "need help?" support
   window on every subpage. Pairs with zenene.css.
   ========================================================= */

(function () {

    const reduceMotion =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- Scroll reveal ---------- */

    function setUpReveal() {

        if (reduceMotion || !("IntersectionObserver" in window)) return;

        // Tab panels manage their own show/hide, so leave them alone.
        const targets = document.querySelectorAll(
            ".page > section:not([role='tabpanel']), .page > .zn-reveal-target"
        );

        if (!targets.length) return;

        document.documentElement.classList.add("zn-motion");

        const observer = new IntersectionObserver(entries => {

            entries.forEach(entry => {

                if (!entry.isIntersecting) return;

                entry.target.classList.add("is-in");
                observer.unobserve(entry.target);

            });

        }, {
            rootMargin: "0px 0px -40px 0px",
            threshold: 0.06
        });

        targets.forEach(target => {
            target.classList.add("zn-reveal");
            observer.observe(target);
        });

    }

    /* ---------- Support window ---------- */

    const SUPPORT_LINKS = [
        ["tel:988", "📞 US: call or text 988"],
        ["sms:741741?body=HOME", "💬 US/Canada: text HOME to 741741"],
        ["tel:116123", "📞 UK/ROI: Samaritans 116 123"],
        ["https://findahelpline.com", "🌍 Elsewhere: findahelpline.com"],
        ["tel:112", "📞 Local emergency support · 112"]
    ];

    function setUpSupport() {

        let overlay = document.getElementById("cm");

        if (!document.querySelector(".crisis-fab")) {

            const fab = document.createElement("button");
            fab.type = "button";
            fab.className = "crisis-fab";
            fab.setAttribute("aria-haspopup", "dialog");
            fab.setAttribute("aria-controls", "cm");
            fab.textContent = "💙 need help?";
            document.body.appendChild(fab);

        }

        if (!overlay) {

            overlay = document.createElement("div");
            overlay.className = "overlay";
            overlay.id = "cm";
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.setAttribute("aria-labelledby", "crisisTitle");
            overlay.innerHTML = `
                <div class="modal">
                    <button class="m-close" type="button" aria-label="Close support window">×</button>
                    <div class="m-title" id="crisisTitle">You're not alone.</div>
                    <div class="m-sub">
                        If you need immediate support, please reach out to a trusted adult
                        or an appropriate local emergency or crisis service.
                    </div>
                </div>`;
            document.body.appendChild(overlay);

        }

        // Same helplines everywhere.
        const modal = overlay.querySelector(".modal");
        modal.querySelectorAll(".c-link").forEach(link => link.remove());

        SUPPORT_LINKS.forEach(([href, label]) => {
            const link = document.createElement("a");
            link.className = "c-link";
            link.href = href;
            link.textContent = label;
            if (href.startsWith("http")) {
                link.target = "_blank";
                link.rel = "noopener";
            }
            modal.appendChild(link);
        });

        const open = () => overlay.classList.add("open");
        const close = () => overlay.classList.remove("open");

        document.querySelectorAll(".crisis-fab").forEach(fab => {
            fab.textContent = "💙 need help?";
            fab.removeAttribute("onclick");
            fab.addEventListener("click", open);
        });

        overlay.removeAttribute("onclick");
        overlay.addEventListener("click", event => {
            if (event.target === overlay) close();
        });

        const closeButton = overlay.querySelector(".m-close");
        if (closeButton) {
            closeButton.removeAttribute("onclick");
            closeButton.addEventListener("click", close);
        }

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") close();
        });

    }

    /* ---------- Soft page-to-page fade ---------- */

    function setUpPageLeave() {

        if (reduceMotion) return;

        // Pages that already fade out call preventDefault first,
        // so this only picks up the ones that don't.
        document.addEventListener("click", event => {

            const link = event.target.closest("a[href]");

            if (
                !link ||
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                link.target === "_blank"
            ) {
                return;
            }

            const destination = new URL(link.href, window.location.href);

            if (
                destination.origin !== window.location.origin ||
                destination.pathname === window.location.pathname ||
                !["http:", "https:"].includes(destination.protocol)
            ) {
                return;
            }

            event.preventDefault();
            document.body.classList.add("is-leaving");

            window.setTimeout(() => {
                window.location.href = destination.href;
            }, 150);

        });

        // Coming back with the browser's back button shows the page again.
        window.addEventListener("pageshow", () => {
            document.body.classList.remove("is-leaving");
        });

    }

    function init() {
        setUpReveal();
        setUpSupport();
        setUpPageLeave();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
