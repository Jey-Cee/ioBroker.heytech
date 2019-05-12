/**
 * http://www.faqs.org/rfcs/rfc854.html
 */
export class Command {
  public static readonly SE = 240;
  public static readonly NOP = 241;
  public static readonly DM = 242;
  public static readonly BRK = 243;
  public static readonly IP = 244;
  public static readonly AO = 245;
  public static readonly AYT = 246;
  public static readonly EC = 247;
  public static readonly EL = 248;
  public static readonly GA = 249;
  public static readonly SB = 250;

  public static readonly WILL = 251;
  public static readonly WONT = 252;
  public static readonly DO = 253;
  public static readonly DONT = 254;
  public static readonly IAC = 255;

  public static readonly ECHO = 1;
  public static readonly SUPPRESS_GO_AHEAD = 3;
  public static readonly STATUS = 5;
  public static readonly TIMING_MARK = 6;
  public static readonly TERMINAL_TYPE = 24;
  public static readonly WINDOW_SIZE = 31;
  public static readonly TERMINAL_SPEED = 32;
  public static readonly REMOTE_FLOW_CONTROL = 33;
  public static readonly LINEMODE = 34;
  public static readonly ENVIRONMENT_VARIABLES = 36;
}
