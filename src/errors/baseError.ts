/**
 * Base class for all Jobnik SDK errors.
 * @public
 */
export class JobnikSDKError extends Error {
  /**
   * The name of the error, typically the class name.
   * This overrides the default 'Error' name and makes it readonly.
   * @override
   * @public
   * @readonly
   */
  public override readonly name: string;

  /**
   * A unique string code identifying the type of error.
   * @public
   * @readonly
   */
  public readonly errorCode: string;

  /**
   * Optional original error that caused this error.
   * This overrides the standard 'cause' property from ES2022 Error and makes it readonly.
   * @override
   * @public
   * @readonly
   */
  public override readonly cause?: unknown;

  /**
   * Creates an instance of JobnikSDKError.
   * @param message - The error message.
   * @param errorCode - A unique string code for this error type.
   * @param cause - Optional original error.
   */
  public constructor(message: string, errorCode: string, cause?: unknown) {
    super(message);

    // Set the name of the error to the class name of the most derived constructor.
    // This ensures that subclasses like NetworkError will have their 'name' property
    // correctly set to 'NetworkError'.
    this.name = new.target.name;
    this.errorCode = errorCode;
    this.cause = cause;

    // Set the prototype explicitly to ensure 'instanceof' works correctly for custom errors.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
