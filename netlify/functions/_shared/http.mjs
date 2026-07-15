export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function methodNotAllowed() {
  return json({ error: 'Bu HTTP metodu desteklenmiyor.' }, 405)
}
