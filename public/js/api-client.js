(function () {
    async function request(path, options = {}) {
        const response = await fetch(path, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || `API request failed: ${response.status}`);
        }

        return data;
    }

    window.KwanLongApi = {
        get(path) {
            return request(path);
        },
        post(path, body) {
            return request(path, {
                method: 'POST',
                body: JSON.stringify(body)
            });
        },
        patch(path, body) {
            return request(path, {
                method: 'PATCH',
                body: JSON.stringify(body)
            });
        },
        delete(path) {
            return request(path, {
                method: 'DELETE'
            });
        }
    };
})();
