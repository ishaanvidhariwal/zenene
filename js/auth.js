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
        .single();

    return {
        id: user.id,
        email: user.email,
        display_name: !error && data ? data.display_name : null
    };
}
