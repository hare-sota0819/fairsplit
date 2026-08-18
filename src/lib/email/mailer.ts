export interface Mailer {
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>
}

/** Stub delivery: logs the link server-side instead of sending mail. */
class ConsoleMailer implements Mailer {
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    console.info(`[mailer stub] password reset for ${to}: ${resetUrl}`)
  }
}

export const mailer: Mailer = new ConsoleMailer()
