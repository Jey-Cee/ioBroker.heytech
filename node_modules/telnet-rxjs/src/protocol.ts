import * as url from 'url';

export type ProtocolType = 'telnet:' | 'telnets:';

export class Protocol {
  public static readonly TELNET: 'telnet:' = 'telnet:';
  public static readonly TELNETS: 'telnets:' = 'telnets:';

  public static build(protocol: ProtocolType, hostname: string, port: number | string) {
    return `${protocol}${hostname}:${port}`;
  }
}
