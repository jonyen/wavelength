// The game's one confirmation dialog. An in-page modal rather than confirm(),
// which blocks the whole page while it is open.
//
// Self-contained: it reads nothing from the game and only touches the markup it
// owns, which is why it lives here rather than in script.js.
(function () {
    "use strict";

    // audio.js defines window.WavelengthAudio. Guard so the dialog still works
    // if that script is blocked or fails to load.
    function sound(name) {
        if (window.WavelengthAudio) window.WavelengthAudio.play(name);
    }

    function askConfirm({ title, body, confirmLabel, cancelLabel = "Cancel" }) {
        const modal = document.getElementById("confirmModal");
        if (!modal) return Promise.resolve(true);

        const okButton = document.getElementById("confirmOkButton");
        const cancelButton = document.getElementById("confirmCancelButton");
        document.getElementById("confirmTitle").textContent = title;
        document.getElementById("confirmBody").textContent = body;
        okButton.textContent = confirmLabel;
        cancelButton.textContent = cancelLabel;

        modal.style.display = "block";
        setTimeout(() => modal.classList.add("show"), 10);
        okButton.focus();

        return new Promise((resolve) => {
            const finish = (result) => {
                modal.classList.remove("show");
                setTimeout(() => { modal.style.display = "none"; }, 300);
                okButton.removeEventListener("click", onOk);
                cancelButton.removeEventListener("click", onCancel);
                modal.removeEventListener("click", onBackdrop);
                document.removeEventListener("keydown", onKey);
                resolve(result);
            };
            const onOk = () => finish(true);
            const onCancel = () => { sound("button"); finish(false); };
            const onBackdrop = (event) => { if (event.target === modal) finish(false); };
            const onKey = (event) => { if (event.key === "Escape") finish(false); };

            okButton.addEventListener("click", onOk);
            cancelButton.addEventListener("click", onCancel);
            modal.addEventListener("click", onBackdrop);
            document.addEventListener("keydown", onKey);
        });
    }

    window.askConfirm = askConfirm;
})();
