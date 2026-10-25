async function initNavAuth() {

    const link = document.getElementById("navAuthLink");

    if (!link) return;

    const profile = await getCurrentProfile();

    if (profile) {
        link.textContent = profile.display_name || "profile";
        link.href = "profile.html";
    } else {
        link.textContent = "sign in";
        link.href = "index.html?auth=login";
    }

}

initNavAuth();
