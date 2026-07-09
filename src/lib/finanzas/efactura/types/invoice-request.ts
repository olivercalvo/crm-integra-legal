/**
 * Tipos TypeScript del InvoiceRequest del PAC eFactura PTY.
 *
 * Generados manualmente a partir de docs/efactura/swagger-v1.json
 * (OpenAPI 3.0.1 "ElectronicInvoice.Application.Api 1.0"). Convención:
 *   - Nombres de propiedades EXACTOS al swagger (español-camelCase) para
 *     que el JSON salga bien sin transformaciones.
 *   - .NET `integer`/`double` → TS `number`.
 *   - .NET `date-time` → TS `string` (ISO 8601 con offset -05:00 panameño).
 *   - Las propiedades nullable del swagger son opcionales (`?:`); todo lo
 *     que NO es nullable y NO está marcado required en el swagger sigue
 *     siendo opcional acá hasta que confirmemos los required exactos con
 *     la DGI/PAC (el swagger no marca required explícito en muchos campos).
 *
 * Subset implementado: el necesario para el mapper Fase 2. Tipos opcionales
 * (gFExpRquest, gVehicNuevo, gMedicina, retenciones, etc.) están como
 * tipos abiertos `Record<string, unknown>` para no acoplarnos a partes del
 * contrato que no usamos.
 */

// ---------------------------------------------------------------------------
// Sub-tipos hoja
// ---------------------------------------------------------------------------

export interface RucEmisor {
  tipoContribuyente: number;
  ruc?: string;
  digitoVerificador?: string;
}

export interface RucReceptor {
  tipoContribuyente: number;
  rucReceptor?: string;
  digitoVerificador?: string;
}

export interface UbicacionEmisor {
  codigoUbicacion?: string;
  corregimiento?: string;
  distrito?: string;
  provincia?: string;
}

export interface UbicacionReceptor {
  codigoUbicacion?: string;
  corregimiento?: string;
  distrito?: string;
  provincia?: string;
}

export interface IdentificacionExtranjera {
  pasaportNumeroIdentificacionExtranjera?: string;
  paisExtranjero?: string;
}

export interface ItbmsItem {
  tasaITBMSAplicable?: string;
  montoITBMS: number;
}

export interface PreciosItem {
  precioUnitarioTransferencia: number;
  descuento?: number;
  precioItem: number;
  precioSeguro?: number;
  precioAcarreo?: number;
  sumaPrecioItem: number;
}

export interface DescuentoBonificacion {
  descripcionDescuentoBonificacion?: string;
  montoDescuentoBonificacion: number;
}

export interface FormaPago {
  formaPago?: string;
  formaPagoDescripcion?: string;
  valorCuotaPagada: number;
}

export interface PagoPlazo {
  numeroSecuenciaCuota: number;
  fechaVencimientoCuota: string; // ISO 8601 con offset -05:00
  valorCuota: number;
  informacionInteresEmisorCuota?: string;
}

// ---------------------------------------------------------------------------
// Composiciones
// ---------------------------------------------------------------------------

export interface InformacionEmisor {
  datosRucEmisor: RucEmisor;
  nombreORazonSocial?: string;
  codigoSucursal?: string;
  coordenadaGeograficaSucursal?: string;
  direccionSucursal?: string;
  ubicacionEmisor: UbicacionEmisor;
  telefonoSucursal?: string;
  direccionCorreoElectronico?: string;
}

export interface InformacionReceptor {
  tipoReceptorFe?: string;
  datosRucReceptor?: RucReceptor;
  nombreRazonReceptor?: string;
  direccionReceptor?: string;
  ubicacionReceptor?: UbicacionReceptor;
  grupoIdentificacionExtranjera?: IdentificacionExtranjera;
  telefonoContactoReceptor?: string;
  correoElectronicoReceptor?: string;
  /**
   * Alias defensivo con el misspelling que aparece en algunos contratos de
   * la DGI ("Recepctor"). Mismo patrón que totalGrabado/totalGravado: se
   * envía el mismo valor bajo ambas claves para no depender de la ortografía.
   */
  correoElectronicoRecepctor?: string;
  paisReceptor?: string;
  paisReceptorNoExisteDescripcion?: string;
}

export interface Item {
  numeroSecuenciaItem: number;
  descripcionProductoServicio?: string;
  codigoInternoItem?: string;
  unidadMedidaCodigoInterno?: string;
  cantidadProductoServicio: number;
  fechaFabricacion?: string;
  fechaCaducidad?: string;
  codigoItemCodificacionPanamenaAbreviada?: number;
  codigoItemCodificacionPanamena?: number;
  unidadMedidaCodificacionPanamena?: string;
  informacionInteresEmisor?: string;
  grupoPrecios: PreciosItem;
  grupoITBMS: ItbmsItem;
}

export interface Totales {
  tiempoPago: number;
  grupoDescuentosBonificaciones?: DescuentoBonificacion[];
  grupoFormasPago?: FormaPago[];
  grupoInformacionPago?: PagoPlazo[];
  totalNeto: number;
  totalITBMS: number;
  totalISC?: number;
  /**
   * Base gravada con ITBMS. `totalGrabado` (con el misspelling oficial de la
   * DGI) es el campo que la DGI valida — NO nullable en el contrato PAC.
   * `totalGravado` (bien escrito) es un alias nullable que la DGI ignora.
   * El mapper envía ambos con el mismo valor para no depender de la ortografía.
   */
  totalGrabado?: number;
  totalGravado?: number;
  totalDescuento?: number;
  totalAcarreo?: number;
  totalSeguro?: number;
  valorTotalFactura: number;
  sumaValoresRecibidos: number;
  vueltoEntregado?: number;
  numeroTotalItems: number;
  totalTodosItems: number;
  totalOtrosGastos?: number;
}

export interface DatosGenerales {
  tipoEmision?: string;
  fechaHoraInicioContingencia?: string;
  razonOperacionContingencia?: string;
  tipoDocumento?: string;
  numeroDocumento: number;
  puntoFacturacion?: string;
  fechaEmision: string; // ISO 8601 con offset -05:00
  fechaSalidaEstimada?: string;
  naturalezaOperacion?: string;
  tipoOperacion: number;
  destinoOperacion: number;
  formatoGeneracionCafe: number;
  maneraEntregaCafe: number;
  envioContenedorReceptor: number;
  procesoGeneracionFe: number;
  tipoTransaccionVenta: number;
  tipoSucursal: number;
  informacionInteresEmisor?: string;
  informacionEmisor: InformacionEmisor;
  informacionReceptor: InformacionReceptor;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface InvoiceRequest {
  cufe?: string;
  datosGenerales: DatosGenerales;
  listaItems: Item[];
  totales: Totales;
  // Bloques opcionales del swagger que no usamos en Fase 2:
  detallePedido?: Record<string, unknown>;
  informacionLogistica?: Record<string, unknown>;
  datosLocal?: Record<string, unknown>;
}
