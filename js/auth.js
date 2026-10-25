async function getCurrentUser() {

    const { data, error } =
        await supabaseClient.auth.getUser();

    if (error || !data.user) {
        return null;
    }

    return data.user;
}

async function getCurrentProfile() {

    const user = await getCurrentUser();

    if (!user) {
        return null;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

    // Fall back to the name given at sign-up until a profile row exists.
    const savedName = !error && data ? data.display_name : null;

    return {
        id: user.id,
        email: user.email,
        display_name: savedName || user.user_metadata?.display_name || null
    };
}
