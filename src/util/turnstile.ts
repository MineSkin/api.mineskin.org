import { Requests } from "../generator/Requests";

export async function verifyTurnstileToken(token: string, ip: string) {
    const response = await Requests.genericRequest({
        method: 'POST',
        url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        headers: {
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({
            secret: process.env.TURNSTILE_SECRET,
            response: token,
            remoteip: ip
        })
    });
    const success = response.data.success;
    if (!success) {
        console.error('Failed turnstile verification', response);
    }
    return success;
}