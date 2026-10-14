export interface normalPage {
  page: number
  size: number
}

export class RequestUtils {
  public static async query<T>(req: Request): Promise<T> {
    const url = new URL(req.url)
    const params = new URLSearchParams(url.search)
    const result: any = {}

    for (const [key, value] of params.entries()) {
      result[key] = value
    }

    return result as T
  }

  public static async form<T>(req: Request): Promise<T> {
    const formData = await req.formData()
    const result: any = {}

    for (const [key, value] of formData.entries()) {
      result[key] = value.toString()
    }

    return result as T
  }

  public static async json<T>(req: Request): Promise<T> {
    return req.json()
  }
}
