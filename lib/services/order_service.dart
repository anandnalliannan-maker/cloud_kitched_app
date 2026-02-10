import 'package:cloud_firestore/cloud_firestore.dart';

import 'menu_service.dart';

class OrderService {
  OrderService({FirebaseFirestore? firestore, MenuService? menuService})
      : _firestore = firestore ?? FirebaseFirestore.instance,
        _menuService = menuService ?? MenuService();

  final FirebaseFirestore _firestore;
  final MenuService _menuService;

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
    await _firestore.runTransaction((tx) async {
      if (items.isEmpty) {
        throw StateError('Cart is empty');
      }

      final docRefs = <DocumentReference<Map<String, dynamic>>>[];
      final quantities = <String, int>{};

      for (final item in items) {
        final id = item['id'] as String;
        final qty = item['qty'] as int;
        final docRef = _menuService.menuRef.doc(id);
        docRefs.add(docRef);
        quantities[id] = qty;
      }

      final snapshots = <DocumentSnapshot<Map<String, dynamic>>>[];
      for (final ref in docRefs) {
        snapshots.add(await tx.get(ref));
      }

      for (final snap in snapshots) {
        if (!snap.exists) {
          throw StateError('Menu item not found');
        }

        final data = snap.data() as Map<String, dynamic>;
        final enabled = data['enabled'] == true;
        final available = (data['quantity'] ?? 0) as int;
        final name = (data['name'] ?? 'Item') as String;
        final id = snap.id;
        final qty = quantities[id] ?? 0;

        if (!enabled || available < qty) {
          throw StateError('Item out of stock: $name');
        }

        tx.update(snap.reference, {
          'quantity': available - qty,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }

      tx.set(_ordersRef.doc(), {
        'customerId': customerId,
        'customerPhone': customerPhone,
        'items': items,
        'total': total,
        'deliveryType': deliveryType,
        'status': 'new',
        'createdAt': FieldValue.serverTimestamp(),
      });
    });
  }
}
