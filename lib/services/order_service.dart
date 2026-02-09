import 'package:cloud_firestore/cloud_firestore.dart';
class OrderService {
  OrderService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> get _ordersRef =>
      _firestore.collection('orders');

  Stream<QuerySnapshot<Map<String, dynamic>>> watchOrdersByStatus(String status) {
    return _ordersRef.where('status', isEqualTo: status).snapshots();
  }

  Future<void> assignOrders({
    required List<String> orderIds,
    required String deliveryUserId,
    required String deliveryPhone,
  }) async {
    final batch = _firestore.batch();

    for (final id in orderIds) {
      final ref = _ordersRef.doc(id);
      batch.update(ref, {
        'deliveryId': deliveryUserId,
        'deliveryPhone': deliveryPhone,
        'status': 'assigned',
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
  }

  Future<void> createOrder({
    required String customerId,
    required String customerPhone,
    required List<Map<String, dynamic>> items,
    required int total,
    required String deliveryType,
  }) async {
    await _ordersRef.add({
      'customerId': customerId,
      'customerPhone': customerPhone,
      'items': items,
      'total': total,
      'deliveryType': deliveryType,
      'status': 'new',
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}
